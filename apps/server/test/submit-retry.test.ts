import { describe, expect, it } from "vitest";
import { events } from "../src/db/schema.js";
import { nextSeq, readAll } from "../src/db/events.js";
import { submitAction, TeamLocks } from "../src/game.js";
import { createGuestSession, createTestApp, postgresUp } from "./helpers.js";

/**
 * Audit follow-up: the optimistic retry in submitAction was never pinned at
 * this level (append-integrity tests the raw append only). This drives a REAL
 * (team_id, seq) unique-violation retry by injecting a phantom event into the
 * FIRST append's own transaction — no simulated failures.
 */

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("submitAction conflict retry", () => {
  it("retries once after a real conflict and appends the retried event", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const teamId = session.teamId;
      const targetSeq = await nextSeq(env.ctx.db, teamId); // seq the first append targets

      let first = true;
      let transactionCalls = 0;
      const wrappedDb = new Proxy(env.ctx.db, {
        get(target, prop) {
          if (prop === "transaction") {
            return (callback: Parameters<typeof env.ctx.db.transaction>[0]) =>
              env.ctx.db.transaction(async (tx) => {
                transactionCalls += 1;
                if (first) {
                  first = false;
                  // A competing writer lands the exact seq INSIDE this
                  // transaction, so the callback's insert really conflicts —
                  // and the conflicting transaction rolls back with itself.
                  await tx.insert(events).values({
                    teamId,
                    seq: targetSeq,
                    type: "ArtifactViewed",
                    payload: { type: "ArtifactViewed", artifactId: "a.phantom", at: new Date().toISOString(), by: session.userId, actorKind: "human" },
                    actorUserId: session.userId,
                    actorKind: "human",
                  });
                }
                return callback(tx);
              });
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      const outcome = await submitAction({
        db: wrappedDb,
        bundle: env.ctx.bundles.get("fixture")!,
        teamId,
        action: { type: "claim", text: "written after a real conflict", private: false },
        actor: { userId: session.userId, kind: "human" },
        clock: { now: () => new Date().toISOString() },
        locks: new TeamLocks(),
      });
      expect(outcome.rejection).toBeUndefined();
      expect(outcome.events.length).toBeGreaterThanOrEqual(1);
      // Two transactions = the conflicting attempt + the retry (without the
      // retry, the first append fails and the caller gets a conflict).
      expect(transactionCalls).toBe(2);

      const stream = await readAll(env.ctx.db, teamId);
      // The retried claim exists at the contested seq, stream has no gaps.
      expect(stream.map((envelope) => envelope.seq)).toEqual(stream.map((_, i) => i + 1));
      const claim = stream.find(
        (envelope) => envelope.event.type === "ClaimCreated" && envelope.event.text === "written after a real conflict"
      );
      expect(claim?.seq).toBe(targetSeq);
    } finally {
      await env.close();
    }
  });
});
