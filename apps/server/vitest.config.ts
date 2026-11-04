import { defineConfig } from "vitest/config";

// Integration tests boot full apps against real Postgres (unique DB each,
// migrations included). Solo runs take ~5s per app; under the full
// workspace's parallel package runs the default 5s test timeout is too tight.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    poolOptions: { forks: { maxForks: 4 } },
  },
});
