// Test helper: a real Postgres 18 in Docker (Testcontainers), migrated.
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { createDatabase, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";

export interface TestDatabase {
  db: Database;
  /** For clients with their own pool, like pg-boss. */
  connectionString: string;
  stop(): Promise<void>;
}

/** Same image as docker-compose.yml, so tests run on the production engine. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:18-alpine",
  ).start();
  const connectionString = container.getConnectionUri();
  const db = createDatabase(connectionString);
  await runMigrations(db);
  return {
    db,
    connectionString,
    async stop() {
      await db.$client.end();
      await container.stop();
    },
  };
}

/**
 * The SQLSTATE code a query failed with, e.g. 23505 unique_violation or
 * 23514 check_violation. Drizzle wraps the driver error; the code is on
 * its cause.
 */
export async function pgErrorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? "no code";
  }
  return "no error";
}
