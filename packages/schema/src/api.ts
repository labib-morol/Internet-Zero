import { z } from "zod";
import { Action, Rejection } from "./actions.js";
import { RuntimeState } from "./state.js";
import { GameEvent } from "./game-events.js";

/**
 * REST contract (frozen at end of M0, §19.3). All routes live under /api.
 */
export const CreateSessionRequest = z.strictObject({ worldId: z.string().min(1) });
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const CreateSessionResponse = z.strictObject({
  teamId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  sessionToken: z.string(),
  /** Shown exactly once; the only way back into a guest account. */
  recoveryCode: z.string(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

export const ResumeSessionRequest = z.strictObject({ recoveryCode: z.string().min(8) });
export type ResumeSessionRequest = z.infer<typeof ResumeSessionRequest>;

export const ResumeSessionResponse = z.strictObject({
  teamId: z.string(),
  userId: z.string(),
  sessionToken: z.string(),
});
export type ResumeSessionResponse = z.infer<typeof ResumeSessionResponse>;

export const WorldSummary = z.strictObject({
  worldId: z.string(),
  title: z.string(),
  summary: z.string(),
  version: z.string(),
  bundleHash: z.string(),
  entry: z.string(),
  /** Host metadata for the in-game network directory (DECISIONS D20). */
  hosts: z
    .array(z.strictObject({ host: z.string(), service: z.string(), title: z.string() }))
    .default([]),
});
export type WorldSummary = z.infer<typeof WorldSummary>;

export const ListWorldsResponse = z.strictObject({ worlds: z.array(WorldSummary) });
export type ListWorldsResponse = z.infer<typeof ListWorldsResponse>;

export const GetStateResponse = z.strictObject({ state: RuntimeState });
export type GetStateResponse = z.infer<typeof GetStateResponse>;

export const SubmitActionRequest = z.strictObject({ action: Action });
export type SubmitActionRequest = z.infer<typeof SubmitActionRequest>;

export const SubmitActionResponse = z.strictObject({
  result: z.unknown().optional(),
  rejection: Rejection.optional(),
  events: z.array(GameEvent),
});
export type SubmitActionResponse = z.infer<typeof SubmitActionResponse>;

export const HealthResponse = z.strictObject({ ok: z.boolean() });
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ReadyResponse = z.strictObject({
  ready: z.boolean(),
  database: z.boolean(),
  migrationsCurrent: z.boolean(),
  bundlesLoaded: z.number().int().min(0),
});
export type ReadyResponse = z.infer<typeof ReadyResponse>;

/** GET /api/case (M1): visible case-file data for the desktop shell's side panel. */
export const CaseFileResponse = z.strictObject({
  openGates: z.array(z.strictObject({ gateId: z.string(), title: z.string() })),
  reports: z.array(
    z.strictObject({
      reportId: z.string(),
      title: z.string(),
      groups: z.array(
        z.strictObject({
          id: z.string(),
          slots: z.array(
            z.strictObject({
              id: z.string(),
              label: z.string(),
              type: z.enum(["identity", "date", "choice", "text"]),
              options: z.array(z.string()).optional(),
              fact: z.string(),
            })
          ),
        })
      ),
    })
  ),
});
export type CaseFileResponse = z.infer<typeof CaseFileResponse>;
