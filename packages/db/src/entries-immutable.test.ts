import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { entries, members, partnerships, projects } from "./schema.js";
import {
  pgErrorCode,
  startTestDatabase,
  type TestDatabase,
} from "./testing.js";

let t: TestDatabase;
beforeAll(async () => {
  t = await startTestDatabase();
});
afterAll(async () => {
  await t?.stop();
});

/** One expense of R$ 150,00 in a fresh project. */
async function seedExpense() {
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
  const [expense] = await t.db
    .insert(entries)
    .values({
      projectId: project!.id,
      type: "expense",
      amount: 15000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: member!.id,
      authorId: member!.id,
      source: "app",
    })
    .returning();
  return expense!;
}

// SQLSTATE 23001 restrict_violation, raised by refuse_entry_change().
describe("entries are immutable", () => {
  it("refuses an UPDATE", async () => {
    const expense = await seedExpense();
    const update = t.db
      .update(entries)
      .set({ amount: 1n })
      .where(eq(entries.id, expense.id));
    expect(await pgErrorCode(update)).toBe("23001");
  });

  it("refuses a DELETE", async () => {
    const expense = await seedExpense();
    const remove = t.db.delete(entries).where(eq(entries.id, expense.id));
    expect(await pgErrorCode(remove)).toBe("23001");
  });

  it("refuses a TRUNCATE", async () => {
    await seedExpense();
    expect(await pgErrorCode(t.db.execute(sql`truncate entries`))).toBe(
      "23001",
    );
  });

  it("keeps the entry unchanged", async () => {
    const expense = await seedExpense();
    await pgErrorCode(
      t.db
        .update(entries)
        .set({ amount: 1n })
        .where(eq(entries.id, expense.id)),
    );
    const [read] = await t.db
      .select()
      .from(entries)
      .where(eq(entries.id, expense.id));
    expect(read!.amount).toBe(15000n);
  });

  it("still accepts new entries and reversals", async () => {
    const expense = await seedExpense();
    const { id, createdAt, ...rest } = expense;
    void createdAt;
    const insert = t.db.insert(entries).values({
      ...rest,
      amount: -expense.amount,
      reversalOf: id,
      reversalReason: "Wrong amount",
    });
    expect(await pgErrorCode(insert)).toBe("no error");
  });
});
