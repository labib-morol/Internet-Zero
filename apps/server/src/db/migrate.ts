import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * Migrations run at boot (drizzle-orm/node-postgres migrator). The folder is
 * apps/server/drizzle; committed SQL files (§19.3).
 */
export async function runMigrations(db: Db, migrationsFolder: string): Promise<void> {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(db, { migrationsFolder });
}

/** Number of migrations declared by the folder's journal. */
export async function declaredMigrationCount(migrationsFolder: string): Promise<number> {
  const journal = JSON.parse(await readFile(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

/**
 * True when the database has applied every migration in the folder (readyz).
 * Returns false if the bookkeeping table cannot be read.
 */
export async function migrationsCurrent(db: Db, expectedCount: number): Promise<boolean> {
  try {
    const applied = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`
    );
    const rows = applied.rows as { count: number }[];
    const count = rows[0]?.count;
    return typeof count === "number" && count >= expectedCount;
  } catch {
    return false;
  }
}
