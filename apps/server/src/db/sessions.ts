import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import type { Db, Tx } from "./client.js";
import { sessionsWeb, users, type SessionWebRow, type UserRow } from "./schema.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(
  db: Db,
  userId: string,
  tokenHash: string,
  options: { ttlMs?: number; teamId?: string } = {}
): Promise<SessionWebRow> {
  const rows = await db
    .insert(sessionsWeb)
    .values({
      userId,
      tokenHash,
      ...(options.teamId !== undefined ? { teamId: options.teamId } : {}),
      expiresAt: new Date(Date.now() + (options.ttlMs ?? SESSION_TTL_MS)),
    })
    .returning();
  const session = rows[0];
  if (session === undefined) throw new Error("createSession: insert returned no row");
  return session;
}

/** Binds an existing session to a team (invite join, §12). */
export async function bindSessionTeam(db: Db | Tx, sessionId: string, teamId: string): Promise<void> {
  await db.update(sessionsWeb).set({ teamId }).where(eq(sessionsWeb.id, sessionId));
}

/** Revokes a session immediately (logout): the row is deleted, not expired. */
export async function revokeSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessionsWeb).where(eq(sessionsWeb.id, sessionId));
}

/**
 * The team of the user's most recent live BOUND session. Recovery continuity:
 * a player who joined a team must land back in that team after recovering
 * their session, not in their first (original solo) membership.
 */
export async function latestLiveSessionTeamId(db: Db, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ teamId: sessionsWeb.teamId })
    .from(sessionsWeb)
    .where(
      and(
        eq(sessionsWeb.userId, userId),
        gt(sessionsWeb.expiresAt, new Date()),
        isNotNull(sessionsWeb.teamId)
      )
    )
    .orderBy(desc(sessionsWeb.createdAt))
    .limit(1);
  return rows[0]?.teamId ?? undefined;
}

export interface SessionWithUser {
  session: SessionWebRow;
  user: UserRow;
}

/** Looks up a live (unexpired) session by token hash; userId always in WHERE scope. */
export async function findLiveSession(db: Db, tokenHash: string): Promise<SessionWithUser | undefined> {
  const rows = await db
    .select({ session: sessionsWeb, user: users })
    .from(sessionsWeb)
    .innerJoin(users, eq(sessionsWeb.userId, users.id))
    .where(and(eq(sessionsWeb.tokenHash, tokenHash), gt(sessionsWeb.expiresAt, new Date())))
    .limit(1);
  return rows[0];
}
