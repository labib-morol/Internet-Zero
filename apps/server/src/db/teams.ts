import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { teamMembers, teams, type TeamRow } from "./schema.js";

export interface CreateTeamInput {
  worldId: string;
  worldVersion: string;
  bundleHash: string;
  name: string;
  clockMode: string;
  startedAt: Date;
  inviteCodeHash?: string | null;
}

export async function createTeam(db: Db, input: CreateTeamInput): Promise<TeamRow> {
  const rows = await db
    .insert(teams)
    .values({
      worldId: input.worldId,
      worldVersion: input.worldVersion,
      bundleHash: input.bundleHash,
      name: input.name,
      clockMode: input.clockMode,
      startedAt: input.startedAt,
      inviteCodeHash: input.inviteCodeHash ?? null,
    })
    .returning();
  const team = rows[0];
  if (team === undefined) throw new Error("createTeam: insert returned no row");
  return team;
}

export async function getTeam(db: Db, teamId: string): Promise<TeamRow | undefined> {
  const rows = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  return rows[0];
}

export async function addTeamMember(
  db: Db,
  teamId: string,
  userId: string,
  role: "owner" | "member"
): Promise<void> {
  await db.insert(teamMembers).values({ teamId, userId, role }).onConflictDoNothing();
}

/**
 * The user's active team. A user may join several teams over time (invite
 * links, M2); until team switching exists the first membership wins.
 */
export async function firstTeamForUser(db: Db, userId: string): Promise<TeamRow | undefined> {
  const rows = await db
    .select({ team: teams })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teamMembers.joinedAt), asc(teams.createdAt))
    .limit(1);
  return rows[0]?.team;
}

export async function membershipRole(db: Db, teamId: string, userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return rows[0]?.role;
}
