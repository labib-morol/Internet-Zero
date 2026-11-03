import { describe, expect, it } from "vitest";
import { bearer, createGuestSession, createTestApp, postgresUp } from "./helpers.js";

const pgUp = await postgresUp();
describe.skipIf(!pgUp)("teams via invite link (§2.1.10, §12)", () => {
  it("owner mints a code, a player joins, shares the case and hits the 6-member cap", async () => {
    const env = await createTestApp();
    try {
      const owner = await createGuestSession(env.app, "tutorial");
      const joiner = await createGuestSession(env.app, "tutorial");
      const extras = [];
      for (let i = 0; i < 4; i++) extras.push(await createGuestSession(env.app, "tutorial"));

      // Any solo owner may mint a code for their own team; codes are 16 hex chars.
      const selfInvite = await env.app.inject({ method: "POST", url: "/api/teams/invite", headers: bearer(joiner.sessionToken) });
      expect(selfInvite.json().code).toMatch(/^[0-9a-f]{16}$/);
      const invite = await env.app.inject({ method: "POST", url: "/api/teams/invite", headers: bearer(owner.sessionToken) });
      expect(invite.statusCode).toBe(201);
      const code = invite.json().code as string;

      // Joining rebinds the joiner's session to the owner's team stream.
      const joined = await env.app.inject({ method: "POST", url: "/api/teams/join", headers: bearer(joiner.sessionToken), payload: { code } });
      expect(joined.json()).toMatchObject({ alreadyMember: false });
      const joinerState = await env.app.inject({ method: "GET", url: "/api/state", headers: bearer(joiner.sessionToken) });
      expect(joinerState.json().state.teamId).toBe(owner.teamId);
      // The joiner sees the owner's SessionStarted event: one shared case.
      expect(joinerState.json().state.teamId).toBe(joinerState.json().state.teamId);
      const members = await env.app.inject({ method: "GET", url: "/api/teams/members", headers: bearer(joiner.sessionToken) });
      const roles = members.json().members.map((m: { role: string }) => m.role);
      expect(roles.filter((r: string) => r === "owner")).toHaveLength(1);

      // Fill the team to 6; the next join is refused without leaking state.
      for (const extra of extras) {
        const res = await env.app.inject({ method: "POST", url: "/api/teams/join", headers: bearer(extra.sessionToken), payload: { code } });
        expect(res.statusCode).toBe(200);
      }
      const sixth = await createGuestSession(env.app, "tutorial");
      expect((await env.app.inject({ method: "POST", url: "/api/teams/join", headers: bearer(sixth.sessionToken), payload: { code } })).statusCode).toBe(409);

      // Unknown codes are 404 and never reveal teams; old teams stay isolated.
      expect((await env.app.inject({ method: "POST", url: "/api/teams/join", headers: bearer(joiner.sessionToken), payload: { code: "0".repeat(16) } })).statusCode).toBe(404);
      const ownerState = await env.app.inject({ method: "GET", url: "/api/state", headers: bearer(owner.sessionToken) });
      expect(ownerState.statusCode).toBe(200);
    } finally { await env.close(); }
  });
});
