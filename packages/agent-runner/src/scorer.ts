import type { GameEvent, WorldBundle } from "@iz/schema";

/**
 * Scorer (master prompt §14.3): pure metrics over a team's event log.
 * No LLM grading anywhere; tokens are filled only by the caller.
 */
export type ScoreReport = {
  world: string;
  agent: string;
  completed: boolean;
  gatesSolved: number;
  gatesTotal: number;
  reportSlotsCorrect: number;
  reportSlotsTotal: number;
  requiredFactsEvidenced: number;
  requiredFactsTotal: number;
  unsupportedClaims: number;
  toolCalls: number;
  hintsUsed: number;
  wallSeconds: number;
  tokens: { input: number | null; output: number | null };
};

export function scoreRun(bundle: WorldBundle, events: GameEvent[], agent: string, toolCalls?: number): ScoreReport {
  const solvedGates = new Set(events.filter((e) => e.type === "GateSolved").map((e) => e.gateId));
  const acceptedGroups = new Set(
    events.filter((e) => e.type === "ReportGroupAccepted").map((e) => `${e.reportId}:${e.groupId}`)
  );
  const reportSlotsCorrect = bundle.reports
    .flatMap((report) => report.groups)
    .filter((g) => acceptedGroups.has(`${reportOf(bundle, g.id)}:${g.id}`))
    .reduce((sum, g) => sum + g.slots.length, 0);
  const reportSlotsTotal = bundle.reports
    .flatMap((r) => r.groups)
    .reduce((sum, g) => sum + g.slots.length, 0);

  const collectedArtifacts = new Set(
    events.filter((e) => e.type === "EvidenceCollected").map((e) => e.artifactId)
  );
  const requiredFacts = bundle.canon.facts.filter((f) => f.required);
  const requiredFactsEvidenced = requiredFacts.filter((fact) =>
    bundle.canon.proofs.some(
      (p) => p.fact === fact.id && p.strength === "direct" && p.artifacts.some((a) => collectedArtifacts.has(a))
    )
  ).length;

  const claims = new Set(events.filter((e) => e.type === "ClaimCreated").map((e) => e.claimId));
  const isSupportLink = (e: GameEvent): e is Extract<GameEvent, { type: "LinkCreated" }> =>
    e.type === "LinkCreated" && e.relation === "supports" && claims.has(e.to);
  const supported = new Set(events.filter(isSupportLink).map((e) => e.to));
  const unsupportedClaims = [...claims].filter((c) => !supported.has(c)).length;

  const hintsUsed = events.filter((e) => e.type === "HintRequested").length;
  const started = events.find((e) => e.type === "SessionStarted");
  const lastAt = events.length > 0 ? events[events.length - 1]!.at : started?.startedAt ?? NOW_DEFAULT;
  const wallSeconds =
    started === undefined ? 0 : Math.max(0, Math.round((Date.parse(lastAt) - Date.parse(startedAt(started))) / 1000));

  const gatesSolved = solvedGates.size;
  const gatesTotal = bundle.gates.length;
  const completed =
    gatesSolved === gatesTotal && reportSlotsCorrect === reportSlotsTotal && reportSlotsTotal > 0;

  return {
    world: `${bundle.world.id}@${bundle.world.version}`,
    agent,
    completed,
    gatesSolved,
    gatesTotal,
    reportSlotsCorrect,
    reportSlotsTotal,
    requiredFactsEvidenced,
    requiredFactsTotal: requiredFacts.length,
    unsupportedClaims,
    toolCalls: toolCalls ?? events.filter((e) => e.type !== "SessionStarted").length,
    hintsUsed,
    wallSeconds,
    tokens: { input: null, output: null },
  };
}

function reportOf(bundle: WorldBundle, groupId: string): string {
  for (const report of bundle.reports) {
    if (report.groups.some((g) => g.id === groupId)) return report.id;
  }
  return "";
}

function startedAt(event: Extract<GameEvent, { type: "SessionStarted" }>): string {
  return event.startedAt;
}

const NOW_DEFAULT = "1970-01-01T00:00:00.000Z";
