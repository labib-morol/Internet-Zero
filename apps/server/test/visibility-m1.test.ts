import { describe, expect, it } from "vitest";
import { bearer, createGuestSession, createTestApp, fixtureAnswer, postgresUp } from "./helpers.js";

const pgUp = await postgresUp();
describe.skipIf(!pgUp)("M1 visibility boundary (real Postgres)", () => {
  it("hides locked terminal hosts before dispatch and lists only reachable current-world hosts", async () => {
    const env = await createTestApp();
    try {
      const alice = await createGuestSession(env.app, "tutorial");
      const bob = await createGuestSession(env.app, "tutorial");
      const bundle = env.ctx.bundles.get("tutorial")!;
      const terminal = bundle.world.hosts.find((host) => host.service === "terminal")!;
      const view = await env.app.inject({ method: "GET", url: `/api/view?host=${terminal.host}&path=/`, headers: bearer(alice.sessionToken) });
      expect(view.json()).toEqual({ view: { notFound: true, host: terminal.host, path: "/" }, collectibles: [] });
      const unknown = await env.app.inject({ method: "GET", url: "/api/view?host=unknown.pcp&path=/", headers: bearer(alice.sessionToken) });
      expect(unknown.json()).toEqual({ view: { notFound: true, host: "unknown.pcp", path: "/" }, collectibles: [] });
      const worlds = await env.app.inject({ method: "GET", url: "/api/worlds", headers: bearer(alice.sessionToken) });
      expect(worlds.json().worlds.map((world: { worldId: string }) => world.worldId)).toEqual(["tutorial"]);
      expect(worlds.body.includes(terminal.host)).toBe(false);
      expect((await env.app.inject({ method: "GET", url: "/api/worlds" })).statusCode).toBe(401);
      const bobView = await env.app.inject({ method: "GET", url: `/api/view?host=${terminal.host}&path=/`, headers: bearer(bob.sessionToken) });
      expect(bobView.json()).toEqual(view.json());
    } finally { await env.close(); }
  });

  it("case projection removes canon keys and gates checks on a hidden terminal host", async () => {
    const env = await createTestApp();
    try {
      const alice = await createGuestSession(env.app);
      const bob = await createGuestSession(env.app);
      const bundle = env.ctx.bundles.get("fixture")!;
      const host = bundle.world.hosts[0]!.host;
      // A host-bound terminal check must not expose its case title before the host exists.
      bundle.world.hosts.push({ host: "hidden.fixture.iz", service: "terminal", requires: { gateSolved: bundle.gates[0]!.id } });
      bundle.gates.push({ id: "g.hidden-terminal", title: "Hidden terminal case", check: { kind: "terminal", host: "hidden.fixture.iz", mustHaveRead: ["/proof"] }, unlocks: [], score: 1 });
      const get = (token: string) => env.app.inject({ method: "GET", url: "/api/case", headers: bearer(token) });
      const before = await get(alice.sessionToken);
      expect(before.statusCode).toBe(200);
      expect(before.body.includes('"fact"')).toBe(false);
      expect(before.body.includes("g.hidden-terminal")).toBe(false);
      const solve = await env.app.inject({ method: "POST", url: "/api/actions", headers: bearer(alice.sessionToken),
        payload: { action: { type: "submitAnswer", gateId: bundle.gates[0]!.id, answer: fixtureAnswer() } } });
      expect(solve.statusCode).toBe(200);
      expect((await get(alice.sessionToken)).body.includes("g.hidden-terminal")).toBe(true);
      expect((await get(bob.sessionToken)).body.includes("g.hidden-terminal")).toBe(false);
      expect(host.length).toBeGreaterThan(0);
    } finally { await env.close(); }
  });
});
