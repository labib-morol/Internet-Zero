import { describe, expect, it } from "vitest";
import type { GameEvent } from "@iz/schema";
import { submitAction, TeamLocks } from "../src/game.js";
import { append, nextSeq, readAfter, readAll } from "../src/db/events.js";
import {
  bearer,
  createGuestSession,
  createTestApp,
  FIXTURE_WORLD_ID,
  postgresUp,
} from "./helpers.js";

const pgUp = await postgresUp();

function claimEvent(userId: string, text: string, at: string): GameEvent {
  return {
    type: "ClaimCreated",
    claimId: `cl.test-${text}`,
    text,
    private: false,
    at,
    by: userId,
    actorKind: "human",
  };
}

describe.skipIf(!pgUp)("event store", () => {
  it("appends, reads and sequences a team stream", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const db = env.ctx.db;

      const initial = await readAll(db, session.teamId);
      expect(initial).toHaveLength(1);
      expect(initial[0]!.seq).toBe(1);
      expect(initial[0]!.event.type).toBe("SessionStarted");
      expect(await nextSeq(db, session.teamId)).toBe(2);

      const result = await append(db, session.teamId, 2, [
        claimEvent(session.userId, "first note", "2026-11-02T10:00:00.000Z"),
      ]);
      expect(result.ok).toBe(true);
      expect(result.appended).toHaveLength(1);
      expect(result.appended[0]!.seq).toBe(2);

      expect(await nextSeq(db, session.teamId)).toBe(3);
      const after = await readAfter(db, session.teamId, 1);
      expect(after).toHaveLength(1);
      expect(after[0]!.event.type).toBe("ClaimCreated");
    } finally {
      await env.close();
    }
  });

  it("rejects an append at an already-taken (team_id, seq) — the unique violation path", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const db = env.ctx.db;

      const result = await append(db, session.teamId, 1, [
        claimEvent(session.userId, "hijack seq 1", "2026-11-02T10:00:01.000Z"),
      ]);
      expect(result.ok).toBe(false);
      expect(result.appended).toHaveLength(0);

      // The stream is untouched: still exactly the SessionStarted event.
      expect(await readAll(db, session.teamId)).toHaveLength(1);
    } finally {
      await env.close();
    }
  });

  it("retries an optimistic-conflict write once with a fresh fold (§12)", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const db = env.ctx.db;
      const bundle = env.ctx.bundles.get(FIXTURE_WORLD_ID)!;
      const actor = { userId: session.userId, kind: "human" as const };
      const clock = { now: () => "2026-11-02T10:00:00.000Z" };

      // Two "workers" race with independent locks: both read lastSeq=1, both
      // try to append at seq 2. The loser must retry ONCE with a fresh fold
      // and succeed at seq 3 — both claims end up in the log exactly once.
      const [a, b] = await Promise.all([
        submitAction({
          db,
          bundle,
          teamId: session.teamId,
          action: { type: "claim", text: "worker A claim", private: false },
          actor,
          clock,
          locks: new TeamLocks(),
        }),
        submitAction({
          db,
          bundle,
          teamId: session.teamId,
          action: { type: "claim", text: "worker B claim", private: false },
          actor,
          clock,
          locks: new TeamLocks(),
        }),
      ]);

      expect(a.rejection).toBeUndefined();
      expect(b.rejection).toBeUndefined();
      expect(a.events).toHaveLength(1);
      expect(b.events).toHaveLength(1);
      expect([a.events[0]!.seq, b.events[0]!.seq].sort()).toEqual([2, 3]);

      const log = await readAll(db, session.teamId);
      expect(log.map((envelope) => envelope.seq)).toEqual([1, 2, 3]);
      const claims = log.filter((envelope) => envelope.event.type === "ClaimCreated");
      expect(claims).toHaveLength(2);
      const texts = claims.map((envelope) => (envelope.event as { text: string }).text).sort();
      expect(texts).toEqual(["worker A claim", "worker B claim"]);
    } finally {
      await env.close();
    }
  });

  it("serializes concurrent actions through the shared team lock", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);

      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          env.app.inject({
            method: "POST",
            url: "/api/actions",
            headers: bearer(session.sessionToken),
            payload: { action: { type: "claim", text: `concurrent claim ${i}`, private: false } },
          })
        )
      );
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);

      const state = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      const claims = Object.keys(state.json().state.claims);
      expect(claims).toHaveLength(5);
    } finally {
      await env.close();
    }
  });
});
