import { defineConfig } from "vitest/config";

// Integration tests boot full apps against real Postgres (unique DB each,
// migrations included). Solo runs take ~5s per app; under the full
// workspace's parallel package runs the default 5s test timeout is too tight.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // 4 forks × (app boots + Postgres pools + Node heap) crashed workers
    // under the full workspace's parallel package runs (Windows 0xC0000409
    // at fork startup). Two forks keep the run green and barely slower; the
    // suite itself is DB-bound, not CPU-bound.
    poolOptions: { forks: { maxForks: 2 } },
    // REQUIRE_POSTGRES=1 (CI) turns silent DB-suite skips into a hard failure.
    globalSetup: "./test/require-postgres.setup.ts",
  },
});
