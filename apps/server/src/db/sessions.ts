import { and, eq, gt } from "drizzle-orm";
import type { Db } from "./client.js";
import { sessionsWeb, users, type SessionWebRow, type UserRow } from "./schema.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(
  db: Db,
  userId: string,
  tokenHash: string,
  ttlMs: number = SESSION_TTL_MS
): Promise<SessionWebRow> {
  const rows = await db
    .insert(sessionsWeb)
    .values({ userId, tokenHash, expiresAt: new Date(Date.now() + ttlMs) })
    .returning();
  const session = rows[0];
  if (session === undefined) throw new Error("createSession: insert returned no row");
  return session;
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
