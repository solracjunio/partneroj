import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordExpense } from "./expenses.js";
import { countUnread, listFeed, markFeedRead } from "./feed.js";
import { installJobQueue, startJobQueue } from "./jobs.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import { addReceipt } from "./receipts.js";
import { recordEntry } from "./record-entry.js";
import { activities, activityReads, categories } from "./schema.js";
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

/** João and Maria (weight 1 each) in a project, with "Material". */
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
  return {
    partnershipId: p.id,
    projectId: project.id,
    materialId: material!.id,
    joao: joao!,
    maria: maria!,
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/** João pays an expense from his pocket. */
function spend(s: Seed, amount = 15000n, description = "cimento") {
  return recordExpense(
    app.db,
    boss,
    { memberId: s.joao, partnershipId: s.partnershipId },
    {
      projectId: s.projectId,
      amount,
      categoryId: s.materialId,
      occurredOn: "2027-01-12",
      description,
    },
  );
}

const feedOf = (s: Seed, memberId: string, before?: string, limit = 30) =>
  listFeed(app.db, {
    partnershipId: s.partnershipId,
    memberId,
    before,
    limit,
  });

describe("listFeed", () => {
  it("lists an expense with who, how much, category and description", async () => {
    const s = await seed();
    const entry = await spend(s);
    const { rows, next } = await feedOf(s, s.maria);
    expect(next).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "entry_recorded",
      actor: { id: s.joao, name: "João" },
      unread: true,
      entry: {
        id: entry.id,
        type: "expense",
        amount: 15000n,
        occurredOn: "2027-01-12",
        category: "Material",
        description: "cimento",
        reversalOf: null,
        reversedBy: null,
        receipts: [],
      },
    });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });

  it("puts the newest first", async () => {
    const s = await seed();
    await spend(s, 100n, "primeiro");
    await spend(s, 200n, "segundo");
    const { rows } = await feedOf(s, s.maria);
    expect(rows.map((r) => r.entry?.description)).toEqual([
      "segundo",
      "primeiro",
    ]);
  });

  it("shows a reversal and marks the original as reversed", async () => {
    const s = await seed();
    const entry = await spend(s);
    const undo = await recordEntry(app.db, boss, {
      projectId: s.projectId,
      type: "expense",
      amount: -15000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: s.joao,
      categoryId: s.materialId,
      authorId: s.joao,
      source: "app",
      reversalOf: entry.id,
      reversalReason: "lancei duas vezes",
    });
    const { rows } = await feedOf(s, s.maria);
    expect(rows.map((r) => r.action)).toEqual([
      "entry_reversed",
      "entry_recorded",
    ]);
    expect(rows[0]!.entry).toMatchObject({
      id: undo.id,
      amount: -15000n,
      reversalOf: entry.id,
      reversalReason: "lancei duas vezes",
    });
    expect(rows[1]!.entry!.reversedBy).toBe(undo.id);
  });

  it("brings the receipts of each entry", async () => {
    const s = await seed();
    const entry = await spend(s);
    const added = await addReceipt(app.db, {
      entryId: entry.id,
      partnershipId: s.partnershipId,
      uploadedBy: s.joao,
      storageKey: `receipts/${entry.id}/a.jpg`,
      contentType: "image/jpeg",
      sizeBytes: 1000,
      sha256: "a".repeat(64),
    });
    const { rows } = await feedOf(s, s.maria);
    expect(rows[0]!.entry!.receipts).toEqual([
      { id: added!.id, contentType: "image/jpeg" },
    ]);
  });

  it("lists a member joining, with no entry", async () => {
    const s = await seed();
    await app.db.insert(activities).values({
      partnershipId: s.partnershipId,
      actorId: s.maria,
      action: "member_joined",
    });
    const { rows } = await feedOf(s, s.joao);
    expect(rows[0]).toMatchObject({
      action: "member_joined",
      actor: { name: "Maria" },
      entry: null,
    });
  });

  it("is unread until read, and never unread for its own actor", async () => {
    const s = await seed();
    await spend(s);
    expect((await feedOf(s, s.joao)).rows[0]!.unread).toBe(false);
    const [row] = (await feedOf(s, s.maria)).rows;
    expect(row!.unread).toBe(true);
    await app.db
      .insert(activityReads)
      .values({ activityId: row!.id, memberId: s.maria });
    expect((await feedOf(s, s.maria)).rows[0]!.unread).toBe(false);
  });

  it("pages with the last id as the cursor, without repeating", async () => {
    const s = await seed();
    for (const cents of [1n, 2n, 3n, 4n, 5n]) {
      await spend(s, cents);
    }
    const first = await feedOf(s, s.maria, undefined, 2);
    const second = await feedOf(s, s.maria, first.next!, 2);
    // An expense recorded between the pages doesn't move the cursor.
    await spend(s, 6n);
    const third = await feedOf(s, s.maria, second.next!, 2);
    const amounts = [first, second, third].flatMap((p) =>
      p.rows.map((r) => r.entry!.amount),
    );
    expect(amounts).toEqual([5n, 4n, 3n, 2n, 1n]);
    expect(third.next).toBeNull();
  });

  it("shows nothing of another partnership", async () => {
    const s = await seed();
    const other = await seed("Outra Obra");
    await spend(other);
    expect((await feedOf(s, s.maria)).rows).toEqual([]);
  });
});

describe("markFeedRead", () => {
  it("marks the given activities read, for that member only", async () => {
    const s = await seed();
    await spend(s);
    const [row] = (await feedOf(s, s.maria)).rows;
    const scope = { partnershipId: s.partnershipId, memberId: s.maria };
    expect(await markFeedRead(app.db, { ...scope, ids: [row!.id] })).toBe(1);
    expect((await feedOf(s, s.maria)).rows[0]!.unread).toBe(false);
    // João's own activity was never unread to him, and stays so.
    expect((await feedOf(s, s.joao)).rows[0]!.unread).toBe(false);
  });

  it("changes nothing the second time", async () => {
    const s = await seed();
    await spend(s);
    const [row] = (await feedOf(s, s.maria)).rows;
    const input = {
      partnershipId: s.partnershipId,
      memberId: s.maria,
      ids: [row!.id],
    };
    await markFeedRead(app.db, input);
    expect(await markFeedRead(app.db, input)).toBe(0);
  });

  it("skips an activity of another partnership", async () => {
    const s = await seed();
    const other = await seed("Outra Obra");
    await spend(other);
    const [foreign] = (await feedOf(other, other.maria)).rows;
    expect(
      await markFeedRead(app.db, {
        partnershipId: s.partnershipId,
        memberId: s.maria,
        ids: [foreign!.id],
      }),
    ).toBe(0);
    expect((await feedOf(other, other.maria)).rows[0]!.unread).toBe(true);
  });

  it("does nothing for an empty list", async () => {
    const s = await seed();
    expect(
      await markFeedRead(app.db, {
        partnershipId: s.partnershipId,
        memberId: s.maria,
        ids: [],
      }),
    ).toBe(0);
  });
});

describe("countUnread", () => {
  it("counts others' unread activities, down to zero once read", async () => {
    const s = await seed();
    await spend(s, 100n);
    await spend(s, 200n);
    const scope = { partnershipId: s.partnershipId, memberId: s.maria };
    expect(await countUnread(app.db, scope)).toBe(2);
    // João did both: nothing is news to him.
    expect(await countUnread(app.db, { ...scope, memberId: s.joao })).toBe(0);
    const ids = (await feedOf(s, s.maria)).rows.map((r) => r.id);
    await markFeedRead(app.db, { ...scope, ids: ids.slice(0, 1) });
    expect(await countUnread(app.db, scope)).toBe(1);
    await markFeedRead(app.db, { ...scope, ids });
    expect(await countUnread(app.db, scope)).toBe(0);
  });

  it("doesn't count another partnership's activities", async () => {
    const s = await seed();
    const other = await seed("Outra Obra");
    await spend(other);
    expect(
      await countUnread(app.db, {
        partnershipId: s.partnershipId,
        memberId: s.maria,
      }),
    ).toBe(0);
  });
});
