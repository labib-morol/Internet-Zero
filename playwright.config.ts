import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

/**
 * E2E (M1 task 13).
 * Browser: bundled chromium in CI; locally the system Edge channel by default
 * (no download). Override with E2E_BROWSER_CHANNEL anywhere (empty string =
 * bundled chromium locally).
 * Database: derived from E2E_DATABASE_ADMIN_URL (default: the local dev
 * instance); the server webServer's bootstrap command creates a uniquely
 * named database per run (`iz_e2e_*`; clean up stale ones locally with
 * `docker exec iz-dev-pg psql -U intranet -d postgres -c
 * "drop database \"iz_e2e_<name>\" with (force)"`). Migrations run at server
 * boot. The session secret is ephemeral per run — never a committed credential.
 */
const sessionSecret = randomBytes(32).toString("hex");
const isCi = Boolean(process.env.CI);

const adminUrl =
  process.env.E2E_DATABASE_ADMIN_URL ?? "postgres://intranet:intranet@localhost:5432/postgres";
const dbName = process.env.E2E_DB_NAME ?? `iz_e2e_${randomBytes(4).toString("hex")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${dbName}`;

const channel =
  process.env.E2E_BROWSER_CHANNEL === undefined && !isCi
    ? "msedge"
    : process.env.E2E_BROWSER_CHANNEL || undefined;

export default defineConfig({
  testDir: "test/e2e",
  timeout: 90_000,
  // Explicit retry policy: one CI retry, reported as flaky in the JSON
  // report — never hidden; none locally so flakes surface during development.
  retries: isCi ? 1 : 0,
  reporters: [
    ["line"],
    ["json", { outputFile: "test-results/e2e-report.json" }],
    ["html", { open: "never", outputFolder: "test-results/html" }],
  ],
  use: {
    ...(channel === undefined ? {} : { channel }),
    baseURL: "http://localhost:5173",
    // CI uploads only reports, never traces/screenshots: public-CI artifacts
    // must not carry page content. Local runs keep failure traces locally.
    trace: isCi ? "off" : "retain-on-failure",
  },
  webServer: [
    {
      command:
        "pnpm --filter @iz/server exec tsx scripts/e2e-ensure-db.ts && pnpm exec tsx apps/server/src/index.ts",
      port: 8080,
      // CI must test a fresh server, never a stale local process.
      reuseExistingServer: !isCi,
      env: {
        DATABASE_URL: databaseUrl.toString(),
        SESSION_SECRET: sessionSecret,
        PUBLIC_ORIGIN: "http://localhost:8080",
        WORLDS_DIR: "dist/worlds",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "pnpm --filter @iz/web exec vite --port 5173 --strictPort",
      port: 5173,
      reuseExistingServer: !isCi,
    },
  ],
});
