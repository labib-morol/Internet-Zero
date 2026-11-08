import { Client } from "pg";

/**
 * E2E bootstrap (runs inside the @iz/server package, where pg resolves):
 * create the database named by DATABASE_URL if it does not exist yet. The
 * server under test runs its own migrations at boot. Refuses non-local hosts
 * unless E2E_ALLOW_REMOTE_DB=1 — CREATE DATABASE is an admin action.
 */

const raw = process.env.DATABASE_URL;
if (raw === undefined || !/^postgres(ql)?:\/\//.test(raw)) {
  throw new Error("DATABASE_URL must be a postgres:// connection string");
}
const url = new URL(raw);
const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (dbName === "" || dbName === "postgres") {
  throw new Error(`refusing to e2e-bootstrap database "${dbName}"`);
}
const hostname = url.hostname.replace(/^\[|\]$/g, "");
const localHosts = ["localhost", "127.0.0.1", "::1"];
if (!localHosts.includes(hostname) && process.env.E2E_ALLOW_REMOTE_DB !== "1") {
  throw new Error(
    `E2E database host "${hostname}" is not local — refusing. ` +
      "Point DATABASE_URL (via E2E_DATABASE_ADMIN_URL in playwright.config.ts) at an isolated local/disposable Postgres or set E2E_ALLOW_REMOTE_DB=1."
  );
}

const adminUrl = new URL(raw);
adminUrl.pathname = "/postgres";
const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  const existing = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (existing.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`[e2e-ensure-db] created database ${dbName}`);
  } else {
    console.log(`[e2e-ensure-db] database ${dbName} already exists`);
  }
} finally {
  await admin.end();
}
