import { describe, expect, it } from "vitest";
import { normalizeAnswer } from "@iz/schema";
import { hashAnswer } from "@iz/runtime";
import { readAll } from "../src/db/events.js";
import { loadTeamState } from "../src/game.js";
import {
  bearer,
  createGuestSession,
  createTestApp,
  fixtureAnswer,
  FIXTURE_WORLD_ID,
  postgresUp,
} from "./helpers.js";

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("end-to-end: answer gate", () => {
  it("solves the fixture answer gate over REST, persists GateSolved and updates score", async () => {
    const env = await createTestApp();
    try {
      const alice = await createGuestSession(env.app);
      const bob = await createGuestSession(env.app);
      const bundle = env.ctx.bundles.get(FIXTURE_WORLD_ID)!;
      const gate = bundle.gates.find((g) => g.id === "g.first-commit")!;
      expect(gate.check.kind).toBe("answer");

      // The plaintext answer comes from the fixture SOURCE; the hash is
      // recomputed with the frozen normalizeAnswer + hashAnswer pair and must
      // match what the compiler baked into the bundle.
      const plaintext = fixtureAnswer();
      const normalized = normalizeAnswer(plaintext, gate.check.kind === "answer" ? gate.check.normalize : []);
      const hash =
        gate.check.kind === "answer"
          ? hashAnswer(bundle.bundleSalt, gate.id, normalized)
          : "";
      expect(gate.check.kind === "answer" ? gate.check.answerHashes : []).toContain(hash);

      // A wrong answer is a graded, recorded rejection.
      const wrong = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(alice.sessionToken),
        payload: { action: { type: "submitAnswer", gateId: "g.first-commit", answer: "definitely not it" } },
      });
      expect(wrong.statusCode).toBe(200);
      const wrongBody = wrong.json();
      expect(wrongBody.rejection.code).toBe("invalid_input");
      expect(wrongBody.events.map((e: { type: string }) => e.type)).toEqual(["AnswerRejected"]);

      // The correct answer solves the gate.
      const right = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(alice.sessionToken),
        payload: { action: { type: "submitAnswer", gateId: "g.first-commit", answer: plaintext } },
      });
      expect(right.statusCode).toBe(200);
      const rightBody = right.json();
      expect(rightBody.rejection).toBeUndefined();
      expect(rightBody.result).toEqual({ accepted: true, solved: true });
      const gateSolved = rightBody.events.find((e: { type: string }) => e.type === "GateSolved");
      expect(gateSolved).toBeDefined();
      expect(gateSolved.gateId).toBe("g.first-commit");
      expect(gateSolved.score).toBe(100);

      // State reflects the solve: unlocked host + score, folded fresh from the log.
      const aliceState = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(alice.sessionToken),
      });
      const aliceJson = aliceState.json().state;
      expect(aliceJson.solvedGates["g.first-commit"]).toBeDefined();
      expect(aliceJson.score).toBe(100);
      expect(aliceJson.unlocked).toContain("mail.fix.pcp");

      // Bob's team is untouched.
      const bobState = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(bob.sessionToken),
      });
      const bobJson = bobState.json().state;
      expect(bobJson.solvedGates).toEqual({});
      expect(bobJson.score).toBe(0);

      // The event log carries the whole story, in order.
      const log = await readAll(env.ctx.db, alice.teamId);
      expect(log.map((envelope) => envelope.event.type)).toEqual([
        "SessionStarted",
        "AnswerRejected",
        "GateSolved",
      ]);
      expect(log[2]!.seq).toBe(3);

      // A fresh fold of the full log reproduces the solved state.
      const refolded = await loadTeamState(env.ctx.db, bundle, alice.teamId);
      expect(refolded.state.solvedGates["g.first-commit"]).toBeDefined();
      expect(refolded.state.score).toBe(100);

      // Solving again is rejected as already solved, revealing nothing new.
      const again = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(alice.sessionToken),
        payload: { action: { type: "submitAnswer", gateId: "g.first-commit", answer: plaintext } },
      });
      expect(again.json().rejection.code).toBe("already_solved");
      expect(again.json().events).toEqual([]);
    } finally {
      await env.close();
    }
  });

  it("rejects submitting answers to unknown gates without leaking anything", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);
      const res = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(session.sessionToken),
        payload: { action: { type: "submitAnswer", gateId: "g.does-not-exist", answer: "guess" } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rejection.code).toBe("not_found");
      expect(body.events).toEqual([]);
    } finally {
      await env.close();
    }
  });
});
