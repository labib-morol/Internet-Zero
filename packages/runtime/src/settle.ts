import type { Actor, Clock, GameEvent, RuntimeState, WorldBundle } from '@iz/schema';
import { replayEvents } from './fold.js';
import { implicitGateSatisfied } from './implicit-gates.js';

/** Materialize progression consequences before persisting an action batch. */
export function settleEvents(
  bundle: WorldBundle, state: RuntimeState, effects: readonly GameEvent[], actor: Actor, clock: Clock,
): GameEvent[] {
  const next = structuredClone(state);
  const events = [...effects];
  replayEvents(bundle, next, effects);
  let changed = true;
  while (changed) {
    changed = false;
    for (const gate of bundle.gates) {
      if (next.solvedGates[gate.id] !== undefined) continue;
      if (!implicitGateSatisfied(bundle, gate, next, (id) => next.unlocked.has(id), clock.now())) continue;
      const event: GameEvent = {
        type: 'GateSolved', gateId: gate.id, score: gate.score,
        at: clock.now(), by: actor.userId, actorKind: actor.kind,
      };
      events.push(event);
      replayEvents(bundle, next, [event]);
      changed = true;
    }
  }
  return events;
}
