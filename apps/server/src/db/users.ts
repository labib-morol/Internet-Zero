import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { users, type UserRow } from "./schema.js";

/**
 * Users (§15). Guests get a display name and a recovery code (stored as a
 * sha256 hash, shown exactly once).
 */
export async function createGuestUser(db: Db, displayName: string, recoveryCodeHash: string): Promise<UserRow> {
  const rows = await db
    .insert(users)
    .values({ kind: "guest", displayName, recoveryCodeHash })
    .returning();
  const user = rows[0];
  if (user === undefined) throw new Error("createGuestUser: insert returned no row");
  return user;
}

export async function getUser(db: Db, userId: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}

/** Recovery-code resume (§12): the only way back into a guest account. */
export async function findUserByRecoveryCodeHash(db: Db, recoveryCodeHash: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.recoveryCodeHash, recoveryCodeHash)).limit(1);
  return rows[0];
}
