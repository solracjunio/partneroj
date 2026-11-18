// Test helper: a real Postgres 18 in Docker (Testcontainers), migrated.
// Exported as @partneroj/db/testing for the apps' tests. It is built into
// dist, but production never imports it: Testcontainers is a dev
// dependency, missing from the production image.
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

export interface AppConnection {
  db: Database;
  connectionString: string;
}

/**
 * Connects as the app does in production: a login user in the
 * partneroj_app role (migration 0006), not the owner of the tables.
 * Call it once per test database; the caller ends `db.$client`.
 */
export async function connectAsApp(t: TestDatabase): Promise<AppConnection> {
  const user = "partneroj_test_app";
  const password = "test-only";
  await t.db.$client.query(
    `CREATE ROLE ${user} LOGIN PASSWORD '${password}' IN ROLE partneroj_app`,
  );
  const url = new URL(t.connectionString);
  url.username = user;
  url.password = password;
  const connectionString = url.toString();
  return { db: createDatabase(connectionString), connectionString };
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

/**
 * Waits until some session is blocked on a lock, as on a locked row or a
 * unique index. A race test holds the first change uncommitted, starts
 * the second, waits here until it is seen waiting, and only then commits:
 * two short transactions in a Promise.all would just run one after the
 * other, and test no race at all.
 */
export async function waitForALockWait(t: TestDatabase): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const { rows } = await t.db.$client.query(
      "select 1 from pg_stat_activity where wait_event_type = 'Lock'",
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("no session ever waited on a lock");
}
