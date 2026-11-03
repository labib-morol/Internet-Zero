import { and, eq, gt } from "drizzle-orm";
import type { Db } from "./client.js";
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
export async function bindSessionTeam(db: Db, sessionId: string, teamId: string): Promise<void> {
  await db.update(sessionsWeb).set({ teamId }).where(eq(sessionsWeb.id, sessionId));
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
