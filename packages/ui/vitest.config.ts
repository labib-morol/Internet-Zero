import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // jsdom-heavy render tests; sequential files avoid worker startup
    // timeouts when the whole workspace runs in parallel.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
