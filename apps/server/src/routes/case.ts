import type { FastifyInstance } from "fastify";
import { CaseFileResponse } from "@iz/schema";
import type { AppContext } from "../app-context.js";
import { loadTeamState } from "../game.js";

/**
 * GET /api/case (M1): the desktop shell's case file side panel data — gates
 * that are available but unsolved (open), and the definition of reports whose
 * gates are visible to this team. Slot ANSWER data never leaves the server.
 */
export function registerCaseRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/case", async (request, reply) => {
    const auth = request.auth;
    if (auth === undefined) return reply.code(401).send({ error: "unauthorized" });
    const bundle = ctx.bundles.get(auth.team.worldId);
    if (bundle === undefined || bundle.bundleHash !== auth.team.bundleHash) {
      return reply.code(409).send({ error: "world build no longer matches the team" });
    }
    const { state } = await loadTeamState(ctx.db, bundle, auth.team.id);
    const now = new Date().toISOString();
    // A gate is "open" when its requires condition is satisfied in state.
    const { evaluateCondition } = await import("@iz/runtime");
    const openGates = bundle.gates
      .filter(
        (gate) =>
          state.solvedGates[gate.id] === undefined &&
          (gate.requires === undefined || evaluateCondition(gate.requires, state, bundle, now))
      )
      .map((gate) => ({ gateId: gate.id, title: gate.title }));
    const openGateIds = new Set(openGates.map((g) => g.gateId));
    const solvedGateIds = new Set(Object.keys(state.solvedGates));
    const reports = bundle.reports.filter((report) =>
      bundle.gates.some(
        (gate) =>
          gate.check.kind === "report" &&
          gate.check.report === report.id &&
          (openGateIds.has(gate.id) ||
            solvedGateIds.has(gate.id) ||
            gate.requires === undefined ||
            evaluateCondition(gate.requires, state, bundle, now))
      )
    );
    return CaseFileResponse.parse({
      openGates,
      reports: reports.map((report) => ({
        reportId: report.id,
        title: report.title,
        groups: report.groups.map((group) => ({
          id: group.id,
          slots: group.slots.map((slot) => ({
            id: slot.id,
            label: slot.label,
            type: slot.type,
            ...(slot.options !== undefined ? { options: slot.options } : {}),
            fact: slot.fact,
          })),
        })),
      })),
    });
  });
}
