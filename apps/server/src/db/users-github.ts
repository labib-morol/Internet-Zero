import { and, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { users, type UserRow } from "./schema.js";

/** Upserts a GitHub user by github_id (§2.1.10, M2). */
export async function upsertGithubUser(db: Db, githubId: string, displayName: string): Promise<UserRow> {
  const existing = await db.select().from(users).where(eq(users.githubId, githubId)).limit(1);
  if (existing[0] !== undefined) return existing[0];
  const rows = await db.insert(users).values({ kind: "github", githubId, displayName }).returning();
  const row = rows[0];
  if (row === undefined) throw new Error("upsertGithubUser: insert returned no row");
  return row;
}

export async function findUserByGithubId(db: Db, githubId: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(and(eq(users.kind, "github"), eq(users.githubId, githubId))).limit(1);
  return rows[0];
}
