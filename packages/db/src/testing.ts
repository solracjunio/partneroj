// Test helper: a real Postgres 18 in Docker (Testcontainers), migrated.
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { createDatabase, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";

export interface TestDatabase {
  db: Database;
  stop(): Promise<void>;
}

/** Same image as docker-compose.yml, so tests run on the production engine. */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "postgres:18-alpine",
  ).start();
  const db = createDatabase(container.getConnectionUri());
  await runMigrations(db);
  return {
    db,
    async stop() {
      await db.$client.end();
      await container.stop();
    },
  };
}
