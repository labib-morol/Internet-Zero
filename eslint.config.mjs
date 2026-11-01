import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Game-logic packages must never touch the host: no processes, no vm, no fs,
// no network, no dynamic code execution. Master prompt §4.2 and §10.5.
const gameLogicBans = {
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        { group: ["child_process", "node:child_process"], message: "Never spawn or execute processes (AGENTS.md)." },
        { group: ["vm", "node:vm"], message: "Never use vm (AGENTS.md)." },
        { group: ["fs", "node:fs", "fs/promises", "node:fs/promises"], message: "No filesystem access from game logic." },
        { group: ["net", "node:net", "dns", "node:dns"], message: "No network access from game logic." },
        { group: ["http", "node:http", "https", "node:https"], message: "No outbound HTTP from game logic (AGENTS.md)." },
        { group: ["worker_threads", "node:worker_threads"], message: "No worker threads from game logic." }
      ]
    }
  ],
  "no-restricted-globals": [
    "error",
    { name: "fetch", message: "No outbound HTTP from game logic (AGENTS.md)." }
  ],
  "no-eval": "error",
  "no-new-func": "error"
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".agents/**", "docs/**", "infra/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error"
    }
  },
  {
    files: ["packages/{runtime,services,terminal,mcp}/**/*.ts"],
    rules: gameLogicBans
  },
  {
    // Determinism (§9): the runtime never reads wall-clock time or randomness.
    files: ["packages/runtime/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: "Runtime is deterministic: receive time via the injected Clock, never Date.now()."
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: "Runtime is deterministic: never use Math.random()."
        }
      ]
    }
  }
);
