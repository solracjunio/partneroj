import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queueEntryNotification, queues, startJobQueue } from "./jobs.js";
import { recordEntry, type NewEntry } from "./record-entry.js";
import {
  activities,
  auditLog,
  entries,
  members,
  partnerships,
  projects,
} from "./schema.js";
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

const feedFor = (entryId: string) =>
  t.db.select().from(activities).where(eq(activities.entryId, entryId));
const auditFor = (entryId: string) =>
  t.db.select().from(auditLog).where(eq(auditLog.entityId, entryId));

describe("recordEntry", () => {
  it("adds the entry to its partnership's feed", async () => {
    const entry = await newExpense();
    const row = await recordEntry(t.db, boss, entry);
    const [project] = await t.db
      .select()
      .from(projects)
      .where(eq(projects.id, entry.projectId));
    expect(await feedFor(row.id)).toMatchObject([
      {
        partnershipId: project!.partnershipId,
        actorId: entry.authorId,
        action: "entry_recorded",
      },
    ]);
  });

  it("audits the entry as it was recorded", async () => {
    const row = await recordEntry(t.db, boss, await newExpense());
    expect(await auditFor(row.id)).toMatchObject([
      {
        actorId: row.authorId,
        action: "entry.record",
        before: null,
        after: { id: row.id, amount: "15000", type: "expense" },
      },
    ]);
  });

  it("marks a reversal as such in the feed and the audit", async () => {
    const original = await recordEntry(t.db, boss, await newExpense());
    const { id, createdAt, ...rest } = original;
    void createdAt;
    const reversal = await recordEntry(t.db, boss, {
      ...rest,
      amount: -original.amount,
      reversalOf: id,
      reversalReason: "Wrong amount",
    });
    expect(await feedFor(reversal.id)).toMatchObject([
      { action: "entry_reversed" },
    ]);
    expect(await auditFor(reversal.id)).toMatchObject([
      { action: "entry.reverse", after: { amount: "-15000" } },
    ]);
  });
});
