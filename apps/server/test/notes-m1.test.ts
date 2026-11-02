import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { upsertNote } from "../src/db/notes.js";
import { privateNotes, teamMembers } from "../src/db/schema.js";
import { addTeamMember } from "../src/db/teams.js";
import { bearer, createGuestSession, createTestApp, listen, postgresUp, WsClient } from "./helpers.js";

const pgUp = await postgresUp();
describe.skipIf(!pgUp)("M1 private notes (real Postgres)", () => {
  it("creates and updates notes only for their user and team, without stream or websocket broadcasts", async () => {
    const env = await createTestApp();
    try {
      const alice = await createGuestSession(env.app);
      const bob = await createGuestSession(env.app);
      const carol = await createGuestSession(env.app);
      const dave = await createGuestSession(env.app);
      for (const [member, owner] of [[bob, alice], [dave, carol]] as const) {
        await env.ctx.db.delete(teamMembers).where(and(eq(teamMembers.teamId, member.teamId), eq(teamMembers.userId, member.userId)));
        await addTeamMember(env.ctx.db, owner.teamId, member.userId, "member");
      }
      const { wsUrl } = await listen(env.app);
      const sockets = await Promise.all([alice, bob, carol, dave].map((user) => WsClient.open(wsUrl, { sessionToken: user.sessionToken, lastSeq: 0 })));
      try {
        for (const socket of sockets) { await socket.waitFor("welcome"); await socket.waitFor("events"); }
        const id = randomUUID();
        const put = (user: typeof alice, body: Record<string, unknown>) => env.app.inject({ method: "PUT", url: "/api/notes", headers: bearer(user.sessionToken), payload: body });
        const get = (user: typeof alice) => env.app.inject({ method: "GET", url: "/api/notes", headers: bearer(user.sessionToken) });
        expect((await put(alice, { id, body: "private note\n<script>plain text</script>" })).statusCode).toBe(200);
        expect((await get(alice)).json().notes).toMatchObject([{ id, body: "private note\n<script>plain text</script>" }]);
        for (const user of [bob, carol, dave]) {
          expect((await get(user)).json()).toEqual({ notes: [] });
          expect((await put(user, { id, body: "foreign overwrite" })).statusCode).toBe(404);
        }
        expect((await put(alice, { id, body: "updated privately" })).statusCode).toBe(200);
        const row = (await env.ctx.db.select().from(privateNotes).where(eq(privateNotes.id, id)))[0]!;
        expect(row).toMatchObject({ userId: alice.userId, teamId: alice.teamId, body: "updated privately" });
        // Same user, another team: repository conflict may not overwrite or list it.
        await upsertNote(env.ctx.db, alice.userId, carol.teamId, id, "wrong team overwrite");
        expect((await get(alice)).json().notes[0].body).toBe("updated privately");
        for (const user of [alice, bob, carol, dave]) {
          const state = await env.app.inject({ method: "GET", url: "/api/state", headers: bearer(user.sessionToken) });
          expect(state.body.includes("updated privately")).toBe(false);
          expect(state.json().state.claims).toEqual({});
        }
        await Promise.all(sockets.map((socket) => socket.expectSilence(250)));
        expect((await env.app.inject({ method: "GET", url: "/api/notes" })).statusCode).toBe(401);
        expect((await env.app.inject({ method: "PUT", url: "/api/notes", payload: { id, body: "x" } })).statusCode).toBe(401);
        for (const invalid of [{ id: "../x", body: "x" }, { id, body: 5 }, { id, body: "x", teamId: carol.teamId }, { id, body: "x".repeat(65537) }]) {
          expect((await put(alice, invalid)).statusCode).toBe(400);
        }
      } finally { await Promise.all(sockets.map((socket) => socket.close())); }
    } finally { await env.close(); }
  });
});
