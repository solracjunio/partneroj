import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordExpense } from "./expenses.js";
import { installJobQueue, queues, startJobQueue } from "./jobs.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import { ReversalRefused, reverseEntry } from "./reversals.js";
import { activities, auditLog, categories, entries } from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

let t: TestDatabase;
let app: AppConnection;
let boss: PgBoss;
beforeAll(async () => {
  t = await startTestDatabase();
  await installJobQueue(t.connectionString);
  app = await connectAsApp(t);
  boss = await startJobQueue(app.connectionString, { sendOnly: true });
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await app?.db.$client.end();
  await t?.stop();
});

/** João and Maria (weight 1 each) in a project, and João's R$ 150 expense. */
async function seed(name = "Obra Teste") {
  const p = await createPartnership(app.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
    ],
    actorId: null,
  });
  const [joao, maria] = p.members.map((m) => m.id);
  const project = await createProject(app.db, {
    partnershipId: p.id,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: [
      { memberId: joao!, weight: 1 },
      { memberId: maria!, weight: 1 },
    ],
    actorId: null,
  });
  await addCategories(app.db, {
    partnershipId: p.id,
    names: ["Material"],
    actorId: null,
  });
  const [material] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id));
  const expense = await recordExpense(
    app.db,
    boss,
    { memberId: joao!, partnershipId: p.id },
    {
      projectId: project.id,
      amount: 15000n,
      categoryId: material!.id,
      occurredOn: "2027-01-12",
      description: "cimento",
    },
  );
  return {
    partnershipId: p.id,
    joao: { memberId: joao!, partnershipId: p.id },
    maria: { memberId: maria!, partnershipId: p.id },
    expense,
  };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReversalRefused) return error.reason;
    throw error;
  }
  return "reversed";
}

const undo = (
  actor: { memberId: string; partnershipId: string },
  entryId: string,
  reason = " lancei duas vezes ",
) => reverseEntry(app.db, boss, actor, { entryId, reason });

const reversalsOf = (entryId: string) =>
  t.db.select().from(entries).where(eq(entries.reversalOf, entryId));

describe("reverseEntry", () => {
  it("records the same entry with the sign inverted, by the author", async () => {
    const s = await seed();
    const row = await undo(s.joao, s.expense.id);
    expect(row).toMatchObject({
      projectId: s.expense.projectId,
      type: "expense",
      amount: -15000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: s.joao.memberId,
      categoryId: s.expense.categoryId,
      description: "cimento",
      authorId: s.joao.memberId,
      source: "app",
      reversalOf: s.expense.id,
      reversalReason: "lancei duas vezes",
    });
  });

  it("adds it to the feed, the audit and the push queue", async () => {
    const s = await seed();
    const row = await undo(s.joao, s.expense.id);
    const [activity] = await t.db
      .select()
      .from(activities)
      .where(eq(activities.entryId, row.id));
    expect(activity).toMatchObject({
      action: "entry_reversed",
      actorId: s.joao.memberId,
    });
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, row.id));
    expect(audit!.action).toBe("entry.reverse");
    const jobs = await boss.fetch(queues.entryNotification, { batchSize: 50 });
    expect(jobs.map((j) => (j.data as { entryId: string }).entryId)).toContain(
      row.id,
    );
  });

  it("refuses someone who is not the author, writing nothing", async () => {
    const s = await seed();
    expect(await refusal(undo(s.maria, s.expense.id))).toBe("not-author");
    expect(await reversalsOf(s.expense.id)).toEqual([]);
  });

  it("refuses an entry of another partnership as not found", async () => {
    const s = await seed();
    const other = await seed("Outra Obra");
    // Same name and role, other partnership: the WHERE tells them apart.
    expect(await refusal(undo(s.joao, other.expense.id))).toBe(
      "entry-not-found",
    );
    expect(await reversalsOf(other.expense.id)).toEqual([]);
  });

  it("refuses a blank reason", async () => {
    const s = await seed();
    expect(await refusal(undo(s.joao, s.expense.id, "   "))).toBe(
      "reason-required",
    );
  });

  it("refuses a second reversal and a reversal of a reversal", async () => {
    const s = await seed();
    const first = await undo(s.joao, s.expense.id);
    expect(await refusal(undo(s.joao, s.expense.id))).toBe("already-reversed");
    expect(await refusal(undo(s.joao, first.id))).toBe("reversal-of-reversal");
  });

  it("lets only one of two reversals at the same moment through", async () => {
    const s = await seed();
    const results = await Promise.all([
      refusal(undo(s.joao, s.expense.id)),
      refusal(undo(s.joao, s.expense.id)),
    ]);
    expect(results.sort()).toEqual(["already-reversed", "reversed"]);
    expect(await reversalsOf(s.expense.id)).toHaveLength(1);
  });
});
