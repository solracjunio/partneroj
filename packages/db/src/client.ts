import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/**
 * One pool per process. pg-boss keeps its own pool for its maintenance,
 * but a job that announces an entry is sent on the entry's transaction
 * (see jobs.ts).
 */
export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  return drizzle({ client: pool, schema, casing: "snake_case" });
}
