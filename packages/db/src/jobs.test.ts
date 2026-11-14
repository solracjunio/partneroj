import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installJobQueue, queueOptions, queues } from "./jobs.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await startTestDatabase();
});
afterAll(async () => {
  await t?.stop();
});

describe("installJobQueue", () => {
  it("gives a queue created before with the defaults its own options", async () => {
    // As in production: entry-notification was created by an older deploy,
    // with pg-boss's defaults (2 retries, no delay).
    const old = new PgBoss({
      connectionString: t.connectionString,
      supervise: false,
      schedule: false,
    });
    old.on("error", () => undefined);
    await old.start();
    await old.createQueue(queues.entryNotification);
    await old.stop({ graceful: false });

    await installJobQueue(t.connectionString);

    const boss = new PgBoss({
      connectionString: t.connectionString,
      supervise: false,
      schedule: false,
    });
    boss.on("error", () => undefined);
    await boss.start();
    try {
      for (const name of Object.values(queues)) {
        expect(await boss.getQueue(name)).toMatchObject(queueOptions[name]);
      }
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
