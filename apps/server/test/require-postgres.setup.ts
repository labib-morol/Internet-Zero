import { postgresUp } from "./helpers.js";

/**
 * REQUIRE_POSTGRES=1 (CI): fail the run instead of letting DB-backed suites
 * skip silently when Postgres is unreachable. A green run with skipped DB
 * suites is not database verification. Local dev without the flag keeps the
 * skip behavior.
 */
export default async function requirePostgres(): Promise<void> {
  if (process.env.REQUIRE_POSTGRES !== "1") return;
  const up = await postgresUp();
  if (!up) {
    // Print directly: vitest's startup-error renderer can mangle thrown
    // setup errors (observed: "code.charCodeAt is not a function"), and the
    // operator must see the real reason, not a stack crash.
    console.error(
      "\n[require-postgres] REQUIRE_POSTGRES=1 but Postgres is unreachable via TEST_DATABASE_ADMIN_URL.\n" +
        "[require-postgres] Failing instead of skipping DB-backed suites — a green run with skipped DB tests is not database verification.\n"
    );
    throw new Error("REQUIRE_POSTGRES=1 but Postgres is unreachable via TEST_DATABASE_ADMIN_URL — failing instead of skipping DB-backed suites.");
  }
}
