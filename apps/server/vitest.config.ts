import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests run against a real Postgres (unique database per app).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Keep file-level parallelism modest: each file provisions its own database.
    fileParallelism: true,
  },
});
