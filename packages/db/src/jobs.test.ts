import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  queueEntryNotification,
  queues,
  recordEntry,
  startJobQueue,
  type NewEntry,
} from "./jobs.js";
import { entries, members, partnerships, projects } from "./schema.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let t: TestDatabase;
let boss: PgBoss;
beforeAll(async () => {
  t = await startTestDatabase();
  boss = await startJobQueue(t.connectionString);
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await t?.stop();
});

/** A new expense of R$ 150,00, not recorded yet. */
async function newExpense(): Promise<NewEntry> {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Test" })
    .returning();
  const [project] = await t.db
    .insert(projects)
    .values({
      partnershipId: p!.id,
      name: "House",
      kind: "construction",
      startsOn: "2027-01-11",
    })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "A", role: "admin" })
    .returning();
  return {
    projectId: project!.id,
    type: "expense",
    amount: 15000n,
    occurredOn: "2027-01-12",
    accrualOn: "2027-01-12",
    fromMemberId: member!.id,
    authorId: member!.id,
    source: "app",
  };
}

const jobsFor = (entryId: string) =>
  boss.findJobs(queues.entryNotification, { data: { entryId } });

class Rollback extends Error {}

describe("an entry and its notification", () => {
  it("are both recorded on commit", async () => {
    const row = await recordEntry(t.db, boss, await newExpense());
    expect(await jobsFor(row.id)).toHaveLength(1);
  });

  it("are both gone on rollback", async () => {
    const entry = await newExpense();
    let entryId = "";
    // Something fails after the job is queued, e.g. the feed row.
    await expect(
      t.db.transaction(async (tx) => {
        const [row] = await tx.insert(entries).values(entry).returning();
        entryId = row!.id;
        await queueEntryNotification(boss, tx, entryId);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    const stored = await t.db
      .select()
      .from(entries)
      .where(eq(entries.id, entryId));
    expect(stored).toHaveLength(0);
    expect(await jobsFor(entryId)).toHaveLength(0);
  });
});
