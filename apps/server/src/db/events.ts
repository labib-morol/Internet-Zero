import type { GameEvent } from "@iz/schema";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Db } from "./client.js";
import { events } from "./schema.js";
import type { EventEnvelope } from "@iz/schema";

export type { EventEnvelope };

/**
 * Event store (§12, §15): one append-only stream per team, seq 1..n enforced
 * by UNIQUE(team_id, seq). Appends use an optimistic version check — the
 * caller passes the sequence it expects to be writing at and the insert
 * silently misses on conflict (unique violation), which the caller resolves by
 * re-folding the stream and retrying ONCE.
 */

export interface AppendResult {
  ok: boolean;
  /** The envelopes that were actually appended (empty when nothing was written). */
  appended: EventEnvelope[];
}

export async function append(
  db: Db,
  teamId: string,
  expectedNextSeq: number,
  gameEvents: GameEvent[]
): Promise<AppendResult> {
  if (gameEvents.length === 0) return { ok: true, appended: [] };
  class AppendConflict extends Error {}
  try {
    return await db.transaction(async (transaction) => {
      const rows = await transaction.insert(events).values(gameEvents.map((event, i) => ({
        teamId, seq: expectedNextSeq + i, type: event.type, payload: event,
        actorUserId: event.by, actorKind: event.actorKind,
      }))).onConflictDoNothing({ target: [events.teamId, events.seq] }).returning({ seq: events.seq });
      if (rows.length !== gameEvents.length) throw new AppendConflict();
      return { ok: true, appended: gameEvents.map((event, i) => ({ seq: expectedNextSeq + i, event })) };
    });
  } catch (error) {
    if (error instanceof AppendConflict) return { ok: false, appended: [] };
    throw error;
  }
}

/** All events of one team ordered by seq (repository: teamId always in WHERE). */
export async function readAll(db: Db, teamId: string): Promise<EventEnvelope[]> {
  const rows = await db
    .select({ seq: events.seq, payload: events.payload })
    .from(events)
    .where(eq(events.teamId, teamId))
    .orderBy(asc(events.seq));
  return rows.map((row) => ({ seq: row.seq, event: row.payload }));
}

/** Events of one team after a sequence number (WebSocket reconnect replay, §12). */
export async function readAfter(db: Db, teamId: string, afterSeq: number): Promise<EventEnvelope[]> {
  if (afterSeq < 0) throw new Error("afterSeq must be >= 0");
  const rows = await db
    .select({ seq: events.seq, payload: events.payload })
    .from(events)
    .where(and(eq(events.teamId, teamId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq));
  return rows.map((row) => ({ seq: row.seq, event: row.payload }));
}

/** The next sequence number for a team's stream (last seq + 1, or 1). */
export async function nextSeq(db: Db, teamId: string): Promise<number> {
  const rows = await db
    .select({ seq: events.seq })
    .from(events)
    .where(eq(events.teamId, teamId))
    .orderBy(desc(events.seq))
    .limit(1);
  const last = rows[0]?.seq;
  return last === undefined ? 1 : last + 1;
}
