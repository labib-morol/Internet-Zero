import { describe, expect, it } from "vitest";
import { bearer, createGuestSession, createTestApp, postgresUp } from "./helpers.js";

/**
 * Task 4 (DECISIONS D28): purchased hint text rides with GET /api/state.
 * The panel-local hint list dies when the window closes while `hintsUsed`
 * (and its cost) persist — the projection restores what was paid for.
 * Unpurchased tiers must NEVER leave the server.
 */

const pgUp = await postgresUp();

describe.skipIf(!pgUp)("purchased hint projection", () => {
  it("omits purchasedHints until a hint is bought, then serves exactly the paid tiers", async () => {
    const env = await createTestApp();
    try {
      const session = await createGuestSession(env.app);

      const before = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      expect(before.statusCode).toBe(200);
      expect(before.json().purchasedHints).toBeUndefined();

      const hint = await env.app.inject({
        method: "POST",
        url: "/api/actions",
        headers: bearer(session.sessionToken),
        payload: { action: { type: "requestHint", gateId: "g.first-commit", tier: 1 } },
      });
      expect(hint.statusCode).toBe(200);
      expect(hint.json().rejection).toBeUndefined();

      const after = await env.app.inject({
        method: "GET",
        url: "/api/state",
        headers: bearer(session.sessionToken),
      });
      expect(after.statusCode).toBe(200);
      const purchased = after.json().purchasedHints as Record<string, Array<{ tier: number; text: string; cost: number }>>;
      expect(purchased["g.first-commit"]).toHaveLength(1);
      expect(purchased["g.first-commit"]?.[0]).toMatchObject({ tier: 1, cost: 10 });
      expect(purchased["g.first-commit"]?.[0]?.text).toContain("commit history");
      // Unpurchased tiers never leave the server.
      expect(JSON.stringify(purchased)).not.toContain("One commit from 2026-10-28");
      expect(JSON.stringify(purchased)).not.toContain("full sha of that commit");
    } finally {
      await env.close();
    }
  });
});
