import { z } from "zod";
import { Action, Rejection } from "./actions.js";
import { EventEnvelope } from "./game-events.js";

/**
 * WebSocket protocol (§12). JSON, validated with Zod. One stream per team;
 * events after lastSeq are replayed on reconnect.
 */
export const ClientMsg = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("hello"), sessionToken: z.string().min(1), lastSeq: z.number().int().min(0) }),
  z.strictObject({ t: z.literal("action"), clientId: z.string().min(1), action: Action }),
  z.strictObject({ t: z.literal("ping") }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export const ServerMsg = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("welcome"), seq: z.number().int().min(0) }),
  z.strictObject({ t: z.literal("events"), events: z.array(EventEnvelope), seq: z.number().int().min(0) }),
  z.strictObject({
    t: z.literal("result"),
    clientId: z.string().min(1),
    result: z.unknown().optional(),
    rejection: Rejection.optional(),
  }),
  z.strictObject({ t: z.literal("pong") }),
]);
export type ServerMsg = z.infer<typeof ServerMsg>;
