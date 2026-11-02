import { and, desc, eq, lte } from "drizzle-orm";
import { RuntimeState, type WorldBundle } from "@iz/schema";
import type { Db } from "./client.js";
import { snapshots } from "./schema.js";
import { stateToWire } from "../state-wire.js";

/** Snapshot payloads are validated, identity-bound caches, not authority. */
export async function readSnapshot(db: Db, bundle: WorldBundle, teamId: string, lastSeq: number): Promise<{ seq: number; state: RuntimeState } | undefined> {
  const rows = await db.select().from(snapshots)
    .where(and(eq(snapshots.teamId, teamId), lte(snapshots.seq, lastSeq)))
    .orderBy(desc(snapshots.seq)).limit(1);
  const row = rows[0];
  if (row === undefined || row.seq <= 0 || row.seq % 200 !== 0) return undefined;
  try {
    const wire = row.state;
    // Reject pre-M1 JSON.stringify(Set) corruption instead of silently losing state.
    if (!Array.isArray(wire.unlocked) || !Array.isArray(wire.firedEvents) ||
      !Object.values(wire.readPaths).every(Array.isArray)) return undefined;
    const state = RuntimeState.parse({ ...wire, unlocked: new Set(wire.unlocked), firedEvents: new Set(wire.firedEvents),
      readPaths: Object.fromEntries(Object.entries(wire.readPaths).map(([host, paths]) => [host, new Set(paths)])) });
    if (state.teamId !== teamId || state.worldId !== bundle.world.id || state.bundleHash !== bundle.bundleHash) return undefined;
    return { seq: row.seq, state };
  } catch { return undefined; }
}

export async function writeSnapshot(db: Db, teamId: string, seq: number, state: RuntimeState): Promise<void> {
  await db.insert(snapshots).values({ teamId, seq, state: stateToWire(state) })
    .onConflictDoUpdate({ target: [snapshots.teamId, snapshots.seq], set: { state: stateToWire(state) } });
}
