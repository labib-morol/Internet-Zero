import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WorldBundle, type GameEvent, type WorldBundle as Bundle } from "@iz/schema";
import { fold, hostReachable, initialState, sessionStartEvent } from "@iz/runtime";
import { forgeView, mailView, archiveView } from "@iz/services";

/**
 * Security acceptance §16: locked artifacts never leave the server. This is
 * the view-layer leak sweep: for every tutorial artifact that is NOT visible
 * to a fresh team, no reachable route's view model may contain a long
 * substring of the locked artifact's body. (Transport-layer sweeps live in
 * apps/server's security tests.)
 */

const bundle: Bundle = WorldBundle.parse(
  JSON.parse(readFileSync(resolve("dist/worlds/tutorial@1.0.0.json"), "utf8"))
);
const NOW = "2026-11-02T09:00:00.000Z";
const fresh = initialState(bundle, "team-leak", NOW);
const isUnlocked = (id: string) => fresh.unlocked.has(id);

function lockedBodies(): Array<{ id: string; sample: string }> {
  const out: Array<{ id: string; sample: string }> = [];
  for (const a of bundle.artifacts) {
    const hostDef = bundle.world.hosts.find((h) => h.host === a.host);
    const reachable = hostDef !== undefined && hostReachable(bundle, hostDef, fresh, isUnlocked, NOW);
    if (reachable && a.visibility === undefined) continue; // visible at start
    if (a.body.length < 24) continue;
    out.push({ id: a.id, sample: a.body.slice(0, 48) });
  }
  return out;
}

/** Every route a fresh team can reach without solving anything. */
function sweepViews(): string[] {
  const payloads: string[] = [];
  const isUnlockedFn = (id: string) => fresh.unlocked.has(id);
  for (const hostDef of bundle.world.hosts) {
    if (!hostReachable(bundle, hostDef, fresh, isUnlockedFn, NOW)) continue;
    const routes = ["/", ...bundle.artifacts.filter((a) => a.host === hostDef.host).map((a) => `/${a.path}`)];
    for (const route of routes) {
      const view =
        hostDef.service === "forge"
          ? forgeView(bundle, fresh, hostDef.host, route, NOW)
          : hostDef.service === "mail"
            ? mailView(bundle, fresh, hostDef.host, route, NOW)
            : hostDef.service === "archive"
              ? archiveView(bundle, fresh, hostDef.host, route, NOW)
              : null;
      if (view !== null) payloads.push(JSON.stringify(view));
    }
    if (hostDef.service === "archive") payloads.push(JSON.stringify(archiveView(bundle, fresh, hostDef.host, "/search/cat", NOW)));
  }
  return payloads;
}

describe("leak suite: locked artifacts never appear in view models", () => {
  const locked = lockedBodies();
  const payloads = sweepViews();

  it("has locked artifacts to test (sanity)", () => {
    expect(locked.length, "tutorial should have gated content").toBeGreaterThan(0);
    expect(payloads.length, "fresh team should reach some routes").toBeGreaterThan(0);
  });

  for (const { id, sample } of locked) {
    it(`locked artifact ${id} never leaks`, () => {
      for (const payload of payloads) {
        expect(payload).not.toContain(sample);
      }
    });
  }

  it("canon keys never appear in any view model", () => {
    for (const payload of payloads) {
      expect(payload).not.toContain('"canon"');
      expect(payload).not.toContain("answerHashes");
      expect(payload).not.toContain("bundleSalt");
    }
  });
});

// Keep the event-log type import used for documentation purposes.
void (0 as unknown as GameEvent);
