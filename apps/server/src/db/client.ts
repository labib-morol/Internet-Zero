import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export interface DbHandle {
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
}

export function createDb(databaseUrl: string, overrides: Partial<{ max: number }> = {}): DbHandle {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: overrides.max ?? 10,
    // Fail fast when the database is unreachable (health checks, tests).
    connectionTimeoutMillis: 5_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export type Db = NodePgDatabase<typeof schema>;

export { schema };
