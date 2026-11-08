import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Task 1 contract: database test infrastructure is env-driven and safe.
 * These tests pin the configuration CI relies on and run WITHOUT Postgres.
 *  - TEST_DATABASE_ADMIN_URL selects the admin connection (CI: postgres/postgres).
 *  - Per-test database URLs are derived from it, swapping only the database.
 *  - Destructive setup refuses remote admin hosts unless explicitly opted in.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

async function importHelpers(): Promise<typeof import("./helpers.js")> {
  return await import("./helpers.js");
}

describe("database test infrastructure configuration", () => {
  it("derives ADMIN_URL from TEST_DATABASE_ADMIN_URL", async () => {
    process.env.TEST_DATABASE_ADMIN_URL = "postgres://ci:secret@db.internal:6543/postgres";
    const helpers = await importHelpers();
    expect(helpers.ADMIN_URL).toBe("postgres://ci:secret@db.internal:6543/postgres");
  });

  it("defaults ADMIN_URL to the local dev instance", async () => {
    delete process.env.TEST_DATABASE_ADMIN_URL;
    const helpers = await importHelpers();
    expect(helpers.ADMIN_URL).toBe("postgres://intranet:intranet@localhost:5432/postgres");
  });

  it("derives per-test database URLs from the admin URL, swapping only the database", async () => {
    process.env.TEST_DATABASE_ADMIN_URL = "postgres://ci:secret@127.0.0.1:6543/postgres";
    const helpers = await importHelpers();
    expect(helpers.deriveTestDatabaseUrl("iz_test_abc123")).toBe(
      "postgres://ci:secret@127.0.0.1:6543/iz_test_abc123"
    );
  });

  it("refuses remote admin hosts for destructive test setup without explicit opt-in", async () => {
    process.env.TEST_DATABASE_ADMIN_URL = "postgres://ci:secret@db.internal:6543/postgres";
    const helpers = await importHelpers();
    expect(() => helpers.deriveTestDatabaseUrl("iz_test_abc123")).toThrow(/TEST_ALLOW_REMOTE_ADMIN/);
  });

  it("allows remote admin hosts with TEST_ALLOW_REMOTE_ADMIN=1", async () => {
    process.env.TEST_DATABASE_ADMIN_URL = "postgres://ci:secret@db.internal:6543/postgres";
    process.env.TEST_ALLOW_REMOTE_ADMIN = "1";
    const helpers = await importHelpers();
    expect(helpers.deriveTestDatabaseUrl("iz_test_abc123")).toBe(
      "postgres://ci:secret@db.internal:6543/iz_test_abc123"
    );
  });

  it("accepts local admin hosts (localhost, 127.0.0.1, ::1) without opt-in", async () => {
    for (const host of ["localhost", "127.0.0.1", "::1"]) {
      const hostPart = host === "::1" ? "[::1]" : host;
      process.env.TEST_DATABASE_ADMIN_URL = `postgres://ci:secret@${hostPart}:5432/postgres`;
      vi.resetModules();
      const helpers = await importHelpers();
      expect(() => helpers.deriveTestDatabaseUrl("iz_test_x"), host).not.toThrow();
    }
  });
});
