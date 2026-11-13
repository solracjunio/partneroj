import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordExpense } from "./expenses.js";
import { installJobQueue, startJobQueue } from "./jobs.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import {
  addReceipt,
  findEntryForReceipt,
  findReceipt,
  type NewReceipt,
} from "./receipts.js";
import { auditLog, categories, receipts } from "./schema.js";
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

/** A partnership with one recorded expense by João. */
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
  const [category] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id));
  const entry = await recordExpense(
    app.db,
    boss,
    { memberId: joao!, partnershipId: p.id },
    {
      projectId: project.id,
      amount: 15000n,
      categoryId: category!.id,
      occurredOn: "2027-01-12",
    },
  );
  return { partnershipId: p.id, joao: joao!, entryId: entry.id };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function receipt(
  s: Awaited<ReturnType<typeof seed>>,
  content = "photo",
): NewReceipt {
  const hash = sha(content);
  return {
    entryId: s.entryId,
    partnershipId: s.partnershipId,
    uploadedBy: s.joao,
    storageKey: `receipts/${s.entryId}/${hash}.jpg`,
    contentType: "image/jpeg",
    sizeBytes: 1234,
    sha256: hash,
  };
}

describe("findEntryForReceipt", () => {
  it("finds an entry of the partnership with its author, not of another", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    expect(
      await findEntryForReceipt(app.db, {
        entryId: ours.entryId,
        partnershipId: ours.partnershipId,
      }),
    ).toEqual({ id: ours.entryId, authorId: ours.joao });
    expect(
      await findEntryForReceipt(app.db, {
        entryId: theirs.entryId,
        partnershipId: ours.partnershipId,
      }),
    ).toBeNull();
  });
});

describe("addReceipt", () => {
  it("records the receipt and audits it", async () => {
    const s = await seed();
    const added = await addReceipt(app.db, receipt(s));
    expect(added?.created).toBe(true);
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, added!.id));
    expect(audit).toMatchObject({ action: "receipt.add", actorId: s.joao });
  });

  it("returns the same receipt when the same file is sent again", async () => {
    const s = await seed();
    const first = await addReceipt(app.db, receipt(s));
    const again = await addReceipt(app.db, receipt(s));
    expect(again).toEqual({ id: first!.id, created: false });
    const rows = await t.db
      .select()
      .from(receipts)
      .where(eq(receipts.entryId, s.entryId));
    expect(rows).toHaveLength(1);
  });

  it("keeps two different files of the same entry", async () => {
    const s = await seed();
    await addReceipt(app.db, receipt(s, "front"));
    await addReceipt(app.db, receipt(s, "back"));
    const rows = await t.db
      .select()
      .from(receipts)
      .where(eq(receipts.entryId, s.entryId));
    expect(rows).toHaveLength(2);
  });

  it("refuses an entry of another partnership, writing nothing", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    const added = await addReceipt(app.db, {
      ...receipt(theirs),
      partnershipId: ours.partnershipId,
      uploadedBy: ours.joao,
    });
    expect(added).toBeNull();
    const rows = await t.db
      .select()
      .from(receipts)
      .where(eq(receipts.entryId, theirs.entryId));
    expect(rows).toEqual([]);
  });
});

describe("findReceipt", () => {
  it("finds a receipt only from its own partnership", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    const added = await addReceipt(app.db, receipt(ours));
    expect(
      await findReceipt(app.db, {
        receiptId: added!.id,
        partnershipId: ours.partnershipId,
      }),
    ).toEqual({
      storageKey: receipt(ours).storageKey,
      contentType: "image/jpeg",
      sizeBytes: 1234,
    });
    expect(
      await findReceipt(app.db, {
        receiptId: added!.id,
        partnershipId: theirs.partnershipId,
      }),
    ).toBeNull();
  });
});
