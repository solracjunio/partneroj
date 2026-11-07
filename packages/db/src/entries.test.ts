import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accounts,
  entries,
  members,
  partnerships,
  projects,
} from "./schema.js";
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

type NewEntry = typeof entries.$inferInsert;

/** A project with one member, one account and one expense of R$ 150,00. */
async function seed() {
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
  const [account] = await t.db
    .insert(accounts)
    .values({ partnershipId: p!.id, name: "Bank" })
    .returning();
  const base = {
    projectId: project!.id,
    occurredOn: "2027-01-12",
    accrualOn: "2027-01-12",
    authorId: member!.id,
    source: "app",
  } satisfies Partial<NewEntry>;
  const [expense] = await t.db
    .insert(entries)
    .values({
      ...base,
      type: "expense",
      amount: 15000n,
      fromMemberId: member!.id,
      description: "Cement",
    })
    .returning();
  return { base, member: member!, account: account!, expense: expense! };
}

/** The reversal of an entry, as the domain's createReversal builds it. */
function reversalOf(entry: NewEntry & { id: string }, reason: string | null) {
  const { id, createdAt, ...rest } = entry;
  void createdAt;
  return {
    ...rest,
    amount: -entry.amount,
    reversalOf: id,
    reversalReason: reason,
  };
}

// SQLSTATE codes: 23514 check_violation, 23505 unique_violation.
describe("entries", () => {
  it("keeps cents beyond the safe range of number", async () => {
    const { base, member } = await seed();
    // 2^53 + 1 cents: a JavaScript number would round it to 2^53.
    const amount = 9_007_199_254_740_993n;
    const [row] = await t.db
      .insert(entries)
      .values({ ...base, type: "expense", amount, fromMemberId: member.id })
      .returning();
    const [read] = await t.db
      .select()
      .from(entries)
      .where(eq(entries.id, row!.id));
    expect(read!.amount).toBe(amount);
  });

  it("records a reversal with a reason", async () => {
    const { expense } = await seed();
    const [reversal] = await t.db
      .insert(entries)
      .values(reversalOf(expense, "Wrong amount"))
      .returning();
    expect(reversal!.amount).toBe(-15000n);
  });

  it("refuses an entry with a zero or negative amount", async () => {
    const { base, member } = await seed();
    const insert = t.db.insert(entries).values({
      ...base,
      type: "expense",
      amount: 0n,
      fromMemberId: member.id,
    });
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("refuses a reversal that keeps the sign", async () => {
    const { expense } = await seed();
    const insert = t.db
      .insert(entries)
      .values({ ...reversalOf(expense, "Oops"), amount: 15000n });
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("refuses a side with both a member and an account", async () => {
    const { base, member, account } = await seed();
    const insert = t.db.insert(entries).values({
      ...base,
      type: "expense",
      amount: 100n,
      fromMemberId: member.id,
      fromAccountId: account.id,
    });
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("refuses a reversal without a reason", async () => {
    const { expense } = await seed();
    expect(
      await pgErrorCode(t.db.insert(entries).values(reversalOf(expense, null))),
    ).toBe("23514");
    expect(
      await pgErrorCode(t.db.insert(entries).values(reversalOf(expense, "  "))),
    ).toBe("23514");
  });

  it("refuses a second reversal of the same entry", async () => {
    const { expense } = await seed();
    await t.db.insert(entries).values(reversalOf(expense, "First"));
    const second = t.db.insert(entries).values(reversalOf(expense, "Second"));
    expect(await pgErrorCode(second)).toBe("23505");
  });

  it("lets only one of two simultaneous reversals through", async () => {
    const { expense } = await seed();
    // Two requests on two pool connections, as two phones tapping "Undo".
    const results = await Promise.all(
      ["Phone 1", "Phone 2"].map((reason) =>
        pgErrorCode(t.db.insert(entries).values(reversalOf(expense, reason))),
      ),
    );
    expect(results.sort()).toEqual(["23505", "no error"]);
  });
});
