import { defineConfig } from "vitest/config";

// Full world compilations are CPU-heavy (hundreds of ms to seconds each) and
// the workspace runs packages in parallel — the 5 s default is too tight.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
