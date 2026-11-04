import { describe, expect, it } from "vitest";
import { createTestApp, postgresUp } from "./helpers.js";
import { setGithubFetchForTests } from "../src/routes/github.js";

/** Fastify's set-cookie header is `string | string[] | undefined`. */
function firstCookieHeader(value: unknown): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

const pgUp = await postgresUp();
describe.skipIf(!pgUp)("github sign-in (§2.1.10, M2)", () => {
  it("returns 503 when unconfigured and completes the flow when configured", async () => {
    const env = await createTestApp();
    try {
      // Unconfigured: honest 503, not a silent dead end.
      expect((await env.app.inject({ method: "GET", url: "/api/auth/github/start" })).statusCode).toBe(503);

      // Configure the OAuth app and stub the GitHub API responses.
      const configuredEnv = await createTestApp();
      try {
        process.env.GITHUB_OAUTH_ID = "test-client-id";
        process.env.GITHUB_OAUTH_SECRET = "test-secret";
        setGithubFetchForTests(async (url, _init) => {
          if (String(url).includes("access_token")) {
            return new Response(JSON.stringify({ access_token: "gho_test" }), { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response(JSON.stringify({ id: 4242, login: "octo-investigator" }), { status: 200, headers: { "content-type": "application/json" } });
        });
        try {
          const start = await configuredEnv.app.inject({ method: "GET", url: "/api/auth/github/start" });
          expect(start.statusCode).toBe(302);
          // The signed cookie value comes back signed; extract the raw state via the callback mismatch check.
          const bad = await configuredEnv.app.inject({ method: "GET", url: "/api/auth/github/callback?code=abc&state=wrong" });
          expect(bad.statusCode, JSON.stringify(bad.body) + String(bad.statusCode)).toBe(400);

          // Recover the signed state from the Set-Cookie header (fastify signs as value.signature)
          const statePair = firstCookieHeader(start.headers["set-cookie"]).split(";")[0]!;
          const signedValue = statePair.split("=").slice(1).join("=");
          const unsigned = signedValue.split(".")[0];
          const callback = await configuredEnv.app.inject({
            method: "GET",
            url: `/api/auth/github/callback?code=real-code&state=${unsigned}`,
            headers: { cookie: `iz_github_state=${signedValue}` },
          });
          expect(callback.statusCode).toBe(302);
          expect(callback.headers.location).toBe("/");

          // The GitHub user has a team, a SessionStarted event and a session.
          const allCookies = callback.headers["set-cookie"];
          const cookieList = Array.isArray(allCookies) ? allCookies : [allCookies ?? ""];
          const sessionPair = cookieList.find((c) => c.startsWith("iz_session=")) ?? "";
          const sessionToken = sessionPair.split(";")[0]!.split("=").slice(1).join("=").split(".")[0];
          const state = await configuredEnv.app.inject({ method: "GET", url: "/api/state", headers: { authorization: `Bearer ${sessionToken}` } });
          expect(state.statusCode, `token=${sessionToken}`).toBe(200);
          expect(state.json().state.startedAt).toBeTypeOf("string");
          const members = await configuredEnv.app.inject({ method: "GET", url: "/api/teams/members", headers: { authorization: `Bearer ${sessionToken}` } });
          expect(members.json().members[0]?.displayName ?? "missing").toBe("octo-investigator");
        } finally {
          delete process.env.GITHUB_OAUTH_ID;
          delete process.env.GITHUB_OAUTH_SECRET;
          setGithubFetchForTests(undefined);
        }
      } finally { await configuredEnv.close(); }
    } finally { await env.close(); }
  });
});
