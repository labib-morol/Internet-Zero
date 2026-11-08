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
  // Idle clients can die out from under the pool (DB restart, terminated
  // backend, admin drop). Without this handler pg surfaces the socket error
  // as an UNHANDLED EXCEPTION and the process dies. Logged; the pool
  // reconnects on the next checkout.
  pool.on("error", (error) => {
    console.error(`[db] idle client error: ${error.message}`);
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export type Db = NodePgDatabase<typeof schema>;

/** Transaction handle type: helpers that must run inside a transaction accept Db | Tx. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export { schema };
