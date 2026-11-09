import { defineConfig } from "vitest/config";

// Integration tests boot full apps against real Postgres (unique DB each,
// migrations included). Solo runs take ~5s per app; under the full
// workspace's parallel package runs the default 5s test timeout is too tight.
export default defineConfig({
  test: {
    // 30s timed out intermittently under the full workspace's parallel run
    // (27 files x heavy module graphs x forks) — different test each run,
    // always in the import phase. The compiler package uses 60s for the same
    // reason. Assertions are unaffected; this is load headroom, not masking.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // 4 forks x (app boots + Postgres pools + Node heap) crashed workers
    // under the full workspace's parallel package runs (Windows 0xC0000409
    // at fork startup). Two forks keep the run green and barely slower; the
    // suite itself is DB-bound, not CPU-bound.
    poolOptions: { forks: { maxForks: 2 } },
    // Each file boots its own apps against unique databases, so sharing a
    // worker is safe here and avoids the per-file fork spawn that kept
    // crashing on Windows (0xC0000409 at startup under load).
    isolate: false,
    // REQUIRE_POSTGRES=1 (CI) turns silent DB-suite skips into a hard failure.
    globalSetup: "./test/require-postgres.setup.ts",
  },
});
