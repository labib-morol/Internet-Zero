import { fileURLToPath } from "node:url";
import { runMigrations, declaredMigrationCount } from "./db/migrate.js";
import { createDb } from "./db/client.js";
import { resolveConfig } from "./config.js";
import { loadDotEnv } from "./config.js";

loadDotEnv(".env");
const config = resolveConfig();
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const { pool, db } = createDb(config.databaseUrl);
try {
  await runMigrations(db, migrationsFolder);
  const declared = await declaredMigrationCount(migrationsFolder);
  process.stdout.write(`migrations current: ${declared}/${declared}\n`);
} finally {
  await pool.end();
}
