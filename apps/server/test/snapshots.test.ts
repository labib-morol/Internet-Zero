import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { GameEvent } from "@iz/schema";
import { fold } from "@iz/runtime";
import { append, readAll } from "../src/db/events.js";
import { snapshots } from "../src/db/schema.js";
import { loadTeamState } from "../src/game.js";
import { bearer, createGuestSession, createTestApp, postgresUp } from "./helpers.js";

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("M1 snapshot cache (real Postgres)", () => {
  it("checkpoints at stream seq 200 and resumes only the tail with all Set state restored", async () => {
    const env = await createTestApp();
    try {
      const alice = await createGuestSession(env.app);
      const bob = await createGuestSession(env.app);
      const bundle = env.ctx.bundles.get("fixture")!;
      const base = { at: "2026-11-02T00:00:00.000Z", by: alice.userId, actorKind: "human" as const };
      const prefix: GameEvent[] = Array.from({ length: 196 }, () => ({
        ...base, type: "ArtifactViewed", artifactId: bundle.artifacts[0]!.id,
      }));
      prefix.push(
        { ...base, type: "TerminalRead", host: bundle.world.hosts[0]!.host, path: "/cache-proof" },
        { ...base, type: "WorldEventFired", eventId: "event.cache-proof" },
        { ...base, type: "GateSolved", gateId: bundle.gates[0]!.id, score: 7 }
      );
      expect((await append(env.ctx.db, alice.teamId, 2, prefix)).ok).toBe(true);
      // The write path must checkpoint a crossed boundary even with a tail.
      const action = await env.app.inject({ method: "POST", url: "/api/actions", headers: bearer(alice.sessionToken),
        payload: { action: { type: "claim", text: "tail observation" } } });
      expect(action.statusCode).toBe(200);
      const rows = await env.ctx.db.select().from(snapshots).where(eq(snapshots.teamId, alice.teamId));
      expect(rows.map((row) => row.seq)).toEqual([200]);
      const loaded = await loadTeamState(env.ctx.db, bundle, alice.teamId);
      const full = await readAll(env.ctx.db, alice.teamId);
      expect(loaded.state).toEqual(fold(bundle, full.map((envelope) => envelope.event)));
      expect(loaded.envelopes.map((envelope) => envelope.seq)).toEqual([201]);
      expect(loaded.state.unlocked).toBeInstanceOf(Set);
      expect(loaded.state.firedEvents.has("event.cache-proof")).toBe(true);
      expect(loaded.state.readPaths[bundle.world.hosts[0]!.host]?.has("/cache-proof")).toBe(true);
      const other = await loadTeamState(env.ctx.db, bundle, bob.teamId);
      expect(other.state.claims).toEqual({});
      expect(other.state.firedEvents.size).toBe(0);
      expect(await env.ctx.db.select().from(snapshots).where(eq(snapshots.teamId, bob.teamId))).toEqual([]);

      // Cache corruption (including stale bundle identity) must fall back to the log.
      for (const replacement of [{ bundleHash: "obsolete" }, { teamId: bob.teamId }, { unlocked: {} }]) {
        const current = (await env.ctx.db.select().from(snapshots).where(eq(snapshots.teamId, alice.teamId)))[0]!;
        await env.ctx.db.update(snapshots).set({ state: { ...current.state, ...replacement } as typeof current.state })
          .where(and(eq(snapshots.teamId, alice.teamId), eq(snapshots.seq, 200)));
        expect((await loadTeamState(env.ctx.db, bundle, alice.teamId)).state)
          .toEqual(fold(bundle, full.map((envelope) => envelope.event)));
      }
      const changedBundle = { ...bundle, bundleHash: "changed-build" };
      await expect(loadTeamState(env.ctx.db, changedBundle, alice.teamId)).rejects.toThrow(/different world or bundle build/);
    } finally { await env.close(); }
  });

  it("creates each crossed 200-event boundary, including a batch ending past seq 400", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const bundle = env.ctx.bundles.get("fixture")!;
      const events: GameEvent[] = Array.from({ length: 404 }, () => ({ type: "ArtifactViewed", artifactId: bundle.artifacts[0]!.id,
        at: "2026-11-02T00:00:00.000Z", by: session.userId, actorKind: "human" }));
      await append(env.ctx.db, session.teamId, 2, events);
      await loadTeamState(env.ctx.db, bundle, session.teamId);
      const rows = await env.ctx.db.select().from(snapshots).where(eq(snapshots.teamId, session.teamId));
      expect(rows.map((row) => row.seq).sort((a, b) => a - b)).toEqual([200, 400]);
      expect((await loadTeamState(env.ctx.db, bundle, session.teamId)).envelopes.map((e) => e.seq)).toEqual([401, 402, 403, 404, 405]);
    } finally { await env.close(); }
  });
});
