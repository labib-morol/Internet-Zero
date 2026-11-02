import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { privateNotes, type PrivateNotesRow } from "./schema.js";
import { privateClaims, type PrivateClaimsRow } from "./schema.js";

/**
 * Private per-user data (§12): never broadcast, never included in shared team
 * state. Every function takes userId AND teamId and includes both in WHERE.
 */

export async function upsertNote(db: Db, userId: string, teamId: string, noteId: string, body: string): Promise<boolean> {
  const rows = await db
    .insert(privateNotes)
    .values({ id: noteId, userId, teamId, body })
    .onConflictDoUpdate({
      target: privateNotes.id,
      set: { body, updatedAt: new Date() },
      setWhere: and(eq(privateNotes.userId, userId), eq(privateNotes.teamId, teamId)),
    }).returning({ id: privateNotes.id });
  return rows.length === 1;
}

export async function listNotes(db: Db, userId: string, teamId: string): Promise<PrivateNotesRow[]> {
  return db
    .select()
    .from(privateNotes)
    .where(and(eq(privateNotes.userId, userId), eq(privateNotes.teamId, teamId)))
    .orderBy(desc(privateNotes.updatedAt));
}

export async function upsertPrivateClaim(
  db: Db,
  userId: string,
  teamId: string,
  claimId: string,
  text: string,
  slots?: Record<string, string>
): Promise<void> {
  await db
    .insert(privateClaims)
    .values({ id: claimId, userId, teamId, text, slots: slots ?? null })
    .onConflictDoUpdate({
      target: privateClaims.id,
      set: { text, slots: slots ?? null, updatedAt: new Date() },
    });
}

export async function listPrivateClaims(db: Db, userId: string, teamId: string): Promise<PrivateClaimsRow[]> {
  return db
    .select()
    .from(privateClaims)
    .where(and(eq(privateClaims.userId, userId), eq(privateClaims.teamId, teamId)))
    .orderBy(desc(privateClaims.updatedAt));
}
