import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  currentProject,
  ExpenseRefused,
  recordExpense,
  type PocketExpense,
} from "./expenses.js";
import { installJobQueue, queues, startJobQueue } from "./jobs.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import { activities, categories, entries } from "./schema.js";
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
  // As in production: the owner installs pg-boss and hands it to the app
  // role; the app then only sends jobs.
  await installJobQueue(t.connectionString);
  app = await connectAsApp(t);
  boss = await startJobQueue(app.connectionString, { sendOnly: true });
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await app?.db.$client.end();
  await t?.stop();
});

/** A partnership with a project (João and Maria weigh 1) and categories. */
async function seed(name = "Obra Teste") {
  const p = await createPartnership(app.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, maria, leo] = p.members.map((m) => m.id);
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
    names: ["Material", "Taxas"],
    actorId: null,
  });
  const [material] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id))
    .orderBy(categories.name);
  return {
    partnershipId: p.id,
    projectId: project.id,
    materialId: material!.id,
    joao: joao!,
    leo: leo!,
  };
}

const expense = (
  s: Awaited<ReturnType<typeof seed>>,
  overrides: Partial<PocketExpense> = {},
): PocketExpense => ({
  projectId: s.projectId,
  amount: 15000n,
  categoryId: s.materialId,
  occurredOn: "2027-01-12",
  description: " cimento ",
  ...overrides,
});

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExpenseRefused) return error.reason;
    throw error;
  }
  return "recorded";
}

describe("currentProject", () => {
  it("returns the project and the category buttons by name", async () => {
    const s = await seed();
    expect(await currentProject(app.db, s.partnershipId)).toEqual({
      project: { id: s.projectId, name: "Casa" },
      categories: [
        { id: s.materialId, name: "Material" },
        { id: expect.any(String) as string, name: "Taxas" },
      ],
    });
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
    expect(await currentProject(app.db, p.id)).toBeNull();
  });
});

describe("recordExpense", () => {
  it("records a pocket expense paid and written by the payer", async () => {
    const s = await seed();
    const payer = { memberId: s.joao, partnershipId: s.partnershipId };
    const row = await recordExpense(app.db, boss, payer, expense(s));
    expect(row).toMatchObject({
      type: "expense",
      amount: 15000n,
      fromMemberId: s.joao,
      fromAccountId: null,
      toMemberId: null,
      authorId: s.joao,
      source: "app",
      accrualOn: "2027-01-12",
      description: "cimento",
    });
  });

  it("adds it to the feed and queues its push, in the same commit", async () => {
    const s = await seed();
    const payer = { memberId: s.joao, partnershipId: s.partnershipId };
    const row = await recordExpense(app.db, boss, payer, expense(s));
    const feed = await t.db
      .select()
      .from(activities)
      .where(eq(activities.entryId, row.id));
    expect(feed).toHaveLength(1);
    const job = await boss.fetch(queues.entryNotification, { batchSize: 50 });
    expect(job.map((j) => (j.data as { entryId: string }).entryId)).toContain(
      row.id,
    );
  });

  it("refuses a project of another partnership, writing nothing", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    const payer = { memberId: ours.joao, partnershipId: ours.partnershipId };
    expect(
      await refusal(
        recordExpense(
          app.db,
          boss,
          payer,
          expense(ours, { projectId: theirs.projectId }),
        ),
      ),
    ).toBe("project-not-found");
    const rows = await t.db
      .select()
      .from(entries)
      .where(eq(entries.authorId, ours.joao));
    expect(rows).toEqual([]);
  });

  it("refuses a category of another partnership", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    const payer = { memberId: ours.joao, partnershipId: ours.partnershipId };
    expect(
      await refusal(
        recordExpense(
          app.db,
          boss,
          payer,
          expense(ours, { categoryId: theirs.materialId }),
        ),
      ),
    ).toBe("category-not-found");
  });

  it("refuses a payer without a weight in the project", async () => {
    const s = await seed();
    const payer = { memberId: s.leo, partnershipId: s.partnershipId };
    expect(await refusal(recordExpense(app.db, boss, payer, expense(s)))).toBe(
      "payer-without-weight",
    );
  });

  it("leaves out an empty description", async () => {
    const s = await seed();
    const payer = { memberId: s.joao, partnershipId: s.partnershipId };
    const row = await recordExpense(
      app.db,
      boss,
      payer,
      expense(s, { description: "   " }),
    );
    expect(row.description).toBeNull();
  });
});
