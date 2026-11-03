import { z } from "zod";

export * from "./primitives.js";
export * from "./safe-ast.js";
export * from "./normalize.js";
export * from "./gates.js";
export * from "./entities.js";
export * from "./world.js";
export * from "./forum.js";
export * from "./artifacts.js";
export * from "./bundle.js";
export * from "./state.js";
export * from "./actions.js";
export * from "./game-events.js";
export * from "./view-models.js";
export * from "./api.js";
export * from "./ws.js";
export * from "./mcp.js";

import { WorldYaml, WorldSource } from "./world.js";
import { Fact } from "./primitives.js";
import { Gate, Report } from "./gates.js";

/** JSON Schema exports of the world format, generated from Zod (§3: Zod is the single source of truth). */
export function worldFormatJsonSchema(): Record<string, unknown> {
  return {
    WorldYaml: z.toJSONSchema(WorldYaml, { io: "input" }),
    WorldSource: z.toJSONSchema(WorldSource, { io: "input" }),
    Fact: z.toJSONSchema(Fact, { io: "input" }),
    Gate: z.toJSONSchema(Gate, { io: "input" }),
    Report: z.toJSONSchema(Report, { io: "input" }),
  };
}
