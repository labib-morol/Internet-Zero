import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client.js";
import { agentTokens, benchmarkRuns, type AgentTokenRow, type BenchmarkRunRow } from "./schema.js";

/**
 * Agent tokens (§14.1, M2 consumers) and benchmark runs. Kept as repositories
 * now so M2 only wires routes. token_hash unique; every query is scoped.
 */

export async function createAgentToken(
  db: Db,
  input: { teamId: string; userId: string; tokenHash: string; label: string }
): Promise<AgentTokenRow> {
  const rows = await db.insert(agentTokens).values(input).returning();
  const row = rows[0];
  if (row === undefined) throw new Error("createAgentToken: insert returned no row");
  return row;
}

/** Live (not revoked) agent token by hash, bound to its team and user. */
export async function findLiveAgentToken(db: Db, tokenHash: string): Promise<AgentTokenRow | undefined> {
  const rows = await db
    .select()
    .from(agentTokens)
    .where(and(eq(agentTokens.tokenHash, tokenHash), isNull(agentTokens.revokedAt)))
    .limit(1);
  return rows[0];
}

export async function revokeAgentToken(db: Db, teamId: string, userId: string, tokenId: string): Promise<void> {
  await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentTokens.teamId, teamId), eq(agentTokens.userId, userId), eq(agentTokens.id, tokenId)));
}

export async function touchAgentToken(db: Db, teamId: string, tokenId: string): Promise<void> {
  await db
    .update(agentTokens)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(agentTokens.teamId, teamId), eq(agentTokens.id, tokenId)));
}

export async function createBenchmarkRun(
  db: Db,
  input: { teamId: string; worldId: string; agentLabel: string; startedAt: Date }
): Promise<BenchmarkRunRow> {
  const rows = await db.insert(benchmarkRuns).values(input).returning();
  const row = rows[0];
  if (row === undefined) throw new Error("createBenchmarkRun: insert returned no row");
  return row;
}

export async function finishBenchmarkRun(
  db: Db,
  teamId: string,
  runId: string,
  metrics: Record<string, unknown>
): Promise<void> {
  await db
    .update(benchmarkRuns)
    .set({ finishedAt: new Date(), metrics })
    .where(and(eq(benchmarkRuns.teamId, teamId), eq(benchmarkRuns.id, runId)));
}
