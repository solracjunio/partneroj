import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectBalances } from "./balances.js";
import { recordExpense } from "./expenses.js";
import { installJobQueue, startJobQueue } from "./jobs.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import { recordEntry } from "./record-entry.js";
import { reverseEntry } from "./reversals.js";
import { accounts, categories } from "./schema.js";
import { eq } from "drizzle-orm";
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

/**
 * A partnership with a project: João, Maria and Ana weigh as given (1
 * each by default), Leo only reads. Returns the ids and the draw order.
 */
async function seed(name = "Obra Teste", w = [1, 1, 1]) {
  const p = await createPartnership(app.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Ana", role: "partner" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, maria, ana] = p.members.map((m) => m.id) as [
    string,
    string,
    string,
  ];
  const project = await createProject(app.db, {
    partnershipId: p.id,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: [
      { memberId: joao, weight: w[0]! },
      { memberId: maria, weight: w[1]! },
      { memberId: ana, weight: w[2]! },
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
  const drawn = [...project.weights]
    .sort((a, b) => a.drawPosition - b.drawPosition)
    .map((x) => x.memberId);
  return {
    partnershipId: p.id,
    projectId: project.id,
    materialId: material!.id,
    joao,
    maria,
    ana,
    drawn,
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/**
 * A seed whose first drawn is not the first inserted, so a query that
 * forgets the draw order fails the test every time instead of passing
 * when the random draw happens to match (1 time in 3).
 */
async function seedDrawnOutOfOrder(): Promise<Seed> {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const s = await seed(`Obra Sorteio ${attempt}`);
    // The first drawn is not the first inserted: the extra cent and the
    // order both show a query that forgot the draw.
    if (s.drawn[0] !== s.joao) return s;
  }
  throw new Error("João was drawn first 20 times");
}

const spend = (s: Seed, memberId: string, amount: bigint) =>
  recordExpense(
    app.db,
    boss,
    { memberId, partnershipId: s.partnershipId },
    {
      projectId: s.projectId,
      amount,
      categoryId: s.materialId,
      occurredOn: "2027-01-12",
    },
  );

/** The balances by member name, to read the tests by name. */
async function byName(s: Seed) {
  const balances = await projectBalances(app.db, s.partnershipId);
  return Object.fromEntries(balances!.partners.map((p) => [p.name, p]));
}

describe("projectBalances", () => {
  it("adds up what each one put in, their fair part and their balance", async () => {
    const s = await seed();
    await spend(s, s.joao, 30000n);
    await spend(s, s.maria, 6000n);

    const balances = await projectBalances(app.db, s.partnershipId);
    expect(balances).toMatchObject({
      project: { id: s.projectId, name: "Casa" },
      sameWeights: true,
      result: -36000n,
      accounts: [],
    });
    const partners = await byName(s);
    expect(partners["João"]).toMatchObject({
      memberId: s.joao,
      weight: 1,
      contributions: 30000n,
      withdrawals: 0n,
      fairShare: 12000n,
      balance: 18000n,
    });
    expect(partners["Maria"]).toMatchObject({
      contributions: 6000n,
      balance: -6000n,
    });
    expect(partners["Ana"]).toMatchObject({
      contributions: 0n,
      balance: -12000n,
    });
    // Without a company account, the balances add up to zero.
    const total = balances!.partners.reduce((sum, p) => sum + p.balance, 0n);
    expect(total).toBe(0n);
  });

  it("lists only the partners who weigh, in the draw order", async () => {
    const s = await seedDrawnOutOfOrder();
    const balances = await projectBalances(app.db, s.partnershipId);
    expect(balances!.partners.map((p) => p.memberId)).toEqual(s.drawn);
  });

  it("gives the extra cent to the first in the draw", async () => {
    const s = await seedDrawnOutOfOrder();
    // R$ 1,00 of loss among three: one of them carries 34 cents.
    await spend(s, s.joao, 100n);
    const balances = await projectBalances(app.db, s.partnershipId);
    const first = balances!.partners.find((p) => p.memberId === s.drawn[0]);
    expect(first!.resultPart).toBe(-34n);
    const others = balances!.partners.filter((p) => p !== first);
    expect(others.map((p) => p.resultPart)).toEqual([-33n, -33n]);
  });

  it("leaves out an undone expense", async () => {
    const s = await seed();
    await spend(s, s.joao, 30000n);
    const wrong = await spend(s, s.maria, 6000n);
    await reverseEntry(
      app.db,
      boss,
      { memberId: s.maria, partnershipId: s.partnershipId },
      { entryId: wrong.id, reason: "lancei duas vezes" },
    );
    const partners = await byName(s);
    expect(partners["Maria"]!.contributions).toBe(0n);
    expect(partners["João"]!.fairShare).toBe(10000n);
  });

  it("follows the weights when they differ", async () => {
    const s = await seed("Obra Pesos", [2, 1, 1]);
    await spend(s, s.maria, 40000n);
    const balances = await projectBalances(app.db, s.partnershipId);
    expect(balances!.sameWeights).toBe(false);
    const partners = await byName(s);
    expect(partners["João"]).toMatchObject({ weight: 2, fairShare: 20000n });
    expect(partners["Maria"]).toMatchObject({ weight: 1, fairShare: 10000n });
  });

  it("shows each company account with its balance, by name", async () => {
    const s = await seed("Obra Conta");
    const [account] = await t.db
      .insert(accounts)
      .values({ partnershipId: s.partnershipId, name: "Conta da obra" })
      .returning();
    await recordEntry(app.db, boss, {
      projectId: s.projectId,
      type: "opening",
      amount: 90000n,
      occurredOn: "2027-01-11",
      accrualOn: "2027-01-11",
      fromMemberId: s.ana,
      toAccountId: account!.id,
      authorId: s.ana,
      source: "app",
    });
    const balances = await projectBalances(app.db, s.partnershipId);
    expect(balances!.accounts).toEqual([
      { id: account!.id, name: "Conta da obra", balance: 90000n },
    ]);
    // The golden rule: the partners' balances add up to the accounts'.
    const total = balances!.partners.reduce((sum, p) => sum + p.balance, 0n);
    expect(total).toBe(90000n);
  });

  it("counts nothing of another partnership", async () => {
    const ours = await seed("Obra Nossa");
    const theirs = await seed("Obra Deles");
    await spend(theirs, theirs.joao, 50000n);
    const balances = await projectBalances(app.db, ours.partnershipId);
    expect(balances!.result).toBe(0n);
    expect(balances!.partners.every((p) => p.contributions === 0n)).toBe(true);
  });

  it("is null for a partnership with no project", async () => {
    const p = await createPartnership(app.db, {
      name: "Sem Projeto",
      members: [
        { name: "A", role: "admin" },
        { name: "B", role: "admin" },
      ],
      actorId: null,
    });
    expect(await projectBalances(app.db, p.id)).toBeNull();
  });
});
