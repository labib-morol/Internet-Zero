import type { EventDef, EventEffect, RuntimeState, WorldBundle } from "@iz/schema";
import { evaluateCondition } from "./conditions.js";
import { worldTimeMs } from "./time.js";

/**
 * World-event due check (§13). Events fire at the START of each apply:
 * - trigger {after: g.x} fires once g.x is solved in the state (i.e. on the
 *   apply AFTER the solve — solving never fires its own events mid-apply);
 * - trigger {at: T} fires when world time has reached T (session mode:
 *   epoch + (now - startedAt)).
 * The optional `requires` is an extra guard; an event whose requires does not
 * hold is simply not due yet and may fire later (it has not consumed itself).
 * firedEvents (rebuilt from WorldEventFired events by fold) prevents refiring.
 */
export function eventIsDue(def: EventDef, state: RuntimeState, bundle: WorldBundle, now: string): boolean {
  if (def.requires !== undefined && !evaluateCondition(def.requires, state, bundle, now)) return false;
  switch (def.trigger.kind) {
    case "after":
      return state.solvedGates[def.trigger.gateSolved] !== undefined;
    case "at": {
      const worldMs = worldTimeMs(bundle, state, now);
      const targetMs = Date.parse(def.trigger.time);
      if (worldMs === undefined || Number.isNaN(targetMs)) return false;
      return worldMs >= targetMs;
    }
  }
}

/**
 * Effect application, as unlocks. Effects only ever ADD ids to `unlocked`:
 * deliverMail -> the message artifact; reveal -> the artifact; revealHosts ->
 * each host; addCommit -> the commit artifact. fold replays the same mapping
 * from the WorldEventFired event + the bundle's EventDef, so apply must not
 * mutate state directly — it collects unlocks in an overlay for the remainder
 * of the current apply and lets the events carry the truth.
 */
export function effectUnlocks(effect: EventEffect, into: Set<string>): void {
  switch (effect.kind) {
    case "deliverMail":
      into.add(effect.message);
      break;
    case "reveal":
      into.add(effect.artifact);
      break;
    case "revealHosts":
      for (const host of effect.hosts) into.add(host);
      break;
    case "addCommit":
      into.add(effect.commit);
      break;
  }
}
