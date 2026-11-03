import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { randomBytes } from "node:crypto";
import { generateToken, hashToken, COOKIE_NAME } from "../auth.js";
import { createSession } from "../db/sessions.js";
import { upsertGithubUser } from "../db/users-github.js";
import { addTeamMember, createTeam, getTeam } from "../db/teams.js";
import { append } from "../db/events.js";
import { sessionStartEvent } from "@iz/runtime";
import type { TeamRow } from "../db/schema.js";
import type { AppContext } from "../app-context.js";

/**
 * Optional GitHub sign-in (§2.1.10, M2). Enabled only when GITHUB_OAUTH_ID and
 * GITHUB_OAUTH_SECRET are configured; otherwise every route returns 503 so the
 * surface is honest about being off. A returning GitHub user rebinds to their
 * most recent team; a new user gets a fresh team and tutorial start event.
 */

const STATE_COOKIE = "iz_github_state";

function configured(): boolean {
  return (
    process.env.GITHUB_OAUTH_ID !== undefined &&
    process.env.GITHUB_OAUTH_ID !== "" &&
    process.env.GITHUB_OAUTH_SECRET !== undefined &&
    process.env.GITHUB_OAUTH_SECRET !== ""
  );
}

/** Injectable for tests: the GitHub API calls (token exchange + user fetch). */
export type GithubFetch = (url: string, init?: RequestInit) => Promise<Response>;
let githubFetchImpl: GithubFetch = fetch;
export function setGithubFetchForTests(impl: GithubFetch | undefined): void {
  githubFetchImpl = impl ?? fetch;
}

export function registerGithubRoutes(app: FastifyInstance, ctx: AppContext): void {
  const unauthorized = (reply: FastifyReply) => reply.code(503).send({ error: "github sign-in is not configured" });

  app.get("/api/auth/github/start", async (request, reply) => {
    if (!configured()) return unauthorized(reply);
    const state = randomBytes(16).toString("hex");
    reply.setCookie(STATE_COOKIE, state, { signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    const params = new URLSearchParams({
      client_id: String(process.env.GITHUB_OAUTH_ID),
      redirect_uri: `${ctx.config.publicOrigin}/api/auth/github/callback`,
      state,
      scope: "read:user",
    });
    return reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
  });

  app.get("/api/auth/github/callback", async (request, reply) => {
    if (!configured()) return unauthorized(reply);
    const query = request.query as { code?: string; state?: string };
    const stateCookie = request.cookies[STATE_COOKIE];
    const unsigned = stateCookie !== undefined ? request.unsignCookie(stateCookie) : undefined;
    if (query.code === undefined || query.state === undefined || unsigned?.valid !== true || unsigned.value !== query.state) {
      return reply.code(400).send({ error: "invalid oauth state" });
    }
    void stateCookie;
    reply.clearCookie(STATE_COOKIE, { path: "/" });

    const tokenResponse = await githubFetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_OAUTH_ID,
        client_secret: process.env.GITHUB_OAUTH_SECRET,
        code: query.code,
        redirect_uri: `${ctx.config.publicOrigin}/api/auth/github/callback`,
      }),
    });
    if (!tokenResponse.ok) return reply.code(502).send({ error: "github token exchange failed" });
    const tokenBody = (await tokenResponse.json()) as { access_token?: string };
    if (tokenBody.access_token === undefined) return reply.code(502).send({ error: "github token exchange failed" });

    const userResponse = await githubFetchImpl("https://api.github.com/user", {
      headers: { authorization: `Bearer ${tokenBody.access_token}`, accept: "application/vnd.github+json", "user-agent": "intranet-zero" },
    });
    if (!userResponse.ok) return reply.code(502).send({ error: "github user fetch failed" });
    const profile = (await userResponse.json()) as { id?: number; login?: string };
    if (profile.id === undefined) return reply.code(502).send({ error: "github user fetch failed" });

    const user = await upsertGithubUser(ctx.db, String(profile.id), profile.login ?? `github-${profile.id}`);
    const existingTeamId = await findTeamForGithubUser(ctx, user.id);
    let team: TeamRow | undefined = existingTeamId !== null ? await getTeam(ctx.db, existingTeamId) : undefined;
    if (team === undefined) {
      const firstWorld = ctx.bundles.list()[0];
      if (firstWorld === undefined) return reply.code(503).send({ error: "no worlds loaded" });
      const startedAt = ctx.clock.now();
      const created = await createTeam(ctx.db, {
        worldId: firstWorld.world.id,
        worldVersion: firstWorld.world.version,
        bundleHash: firstWorld.bundleHash,
        name: user.displayName,
        clockMode: firstWorld.world.clock.mode,
        startedAt: new Date(startedAt),
      });
      await addTeamMember(ctx.db, created.id, user.id, "owner");
      const startEvent = sessionStartEvent(firstWorld, created.id, startedAt, { userId: user.id, kind: "human" });
      const appended = await append(ctx.db, created.id, 1, [startEvent]);
      if (!appended.ok) throw new Error("fresh github team stream refused its first event");
      team = created;
    }

    const sessionToken = generateToken();
    if (team === undefined) return reply.code(503).send({ error: "no worlds loaded" });
    await createSession(ctx.db, user.id, hashToken(sessionToken), { teamId: team.id });
    reply.setCookie(COOKIE_NAME, sessionToken, {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: ctx.config.publicOrigin.startsWith("https://"),
    });
    return reply.redirect("/");
  });
}

/** GitHub users rejoin their most recent team membership (v1: single team). */
async function findTeamForGithubUser(ctx: AppContext, userId: string): Promise<string | null> {
  const { teamMembers } = await import("../db/schema.js");
  const { asc } = await import("drizzle-orm");
  const rows = await ctx.db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teamMembers.joinedAt))
    .limit(1);
  return rows[0]?.teamId ?? null;
}
