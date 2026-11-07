import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

/**
 * One pool per process. pg-boss will share it, so a job can be sent on the
 * same connection, and in the same transaction, as the entry it announces.
 */
export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  return drizzle({ client: pool, schema, casing: "snake_case" });
}
