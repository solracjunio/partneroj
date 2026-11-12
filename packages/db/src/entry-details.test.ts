import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordExpense } from "./expenses.js";
import { installJobQueue, startJobQueue } from "./jobs.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import { findEntryDetails } from "./entry-details.js";
import { addReceipt } from "./receipts.js";
import { reverseEntry } from "./reversals.js";
import { categories } from "./schema.js";
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

const details = (
  actor: { memberId: string; partnershipId: string },
  entryId: string,
) => findEntryDetails(app.db, { ...actor, entryId });

describe("findEntryDetails", () => {
  it("shows the entry, who paid and recorded it, and its receipts", async () => {
    const s = await seed();
    const added = await addReceipt(app.db, {
      entryId: s.expense.id,
      partnershipId: s.partnershipId,
      uploadedBy: s.joao.memberId,
      storageKey: `receipts/${s.expense.id}/a.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 1000,
      sha256: "a".repeat(64),
    });
    const row = await details(s.maria, s.expense.id);
    expect(row).toMatchObject({
      id: s.expense.id,
      type: "expense",
      amount: 15000n,
      occurredOn: "2027-01-12",
      category: "Material",
      description: "cimento",
      paidBy: { id: s.joao.memberId, name: "João" },
      author: { id: s.joao.memberId, name: "João" },
      receipts: [{ id: added!.id, contentType: "image/jpeg" }],
      reversal: null,
      reversalOf: null,
    });
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  it("lets only the author undo it", async () => {
    const s = await seed();
    expect((await details(s.joao, s.expense.id))!.canReverse).toBe(true);
    expect((await details(s.maria, s.expense.id))!.canReverse).toBe(false);
  });

  it("shows the reversal, and neither entry can be undone again", async () => {
    const s = await seed();
    const undo = await reverseEntry(app.db, boss, s.joao, {
      entryId: s.expense.id,
      reason: "lancei duas vezes",
    });
    const original = await details(s.joao, s.expense.id);
    expect(original).toMatchObject({
      reversal: {
        id: undo.id,
        reason: "lancei duas vezes",
        by: { id: s.joao.memberId, name: "João" },
      },
      canReverse: false,
    });
    const reversal = await details(s.joao, undo.id);
    expect(reversal).toMatchObject({
      amount: -15000n,
      reversalOf: s.expense.id,
      canReverse: false,
    });
  });

  it("is null for another partnership's entry", async () => {
    const s = await seed();
    const other = await seed("Outra Obra");
    expect(await details(s.joao, other.expense.id)).toBeNull();
  });
});
