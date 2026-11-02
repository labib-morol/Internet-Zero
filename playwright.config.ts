import { defineConfig } from "@playwright/test";

/**
 * E2E (M1 task 13). Uses the system Edge channel so no browser download is
 * required; falls back to bundled chromium when installed.
 */
export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    channel: "msedge",
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec tsx apps/server/src/index.ts",
      port: 8080,
      reuseExistingServer: true,
      env: {
        DATABASE_URL: "postgres://intranet:intranet@localhost:5432/intranet_zero",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef01234567",
        PUBLIC_ORIGIN: "http://localhost:8080",
        WORLDS_DIR: "dist/worlds",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "pnpm --filter @iz/web exec vite --port 5173 --strictPort",
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
