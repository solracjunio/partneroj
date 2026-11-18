import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveChoice,
  ChoiceRefused,
  createChoice,
  listChoices,
  renameChoice,
  restoreChoice,
  type ChoiceKind,
} from "./accounts-categories.js";
import { createPartnership } from "./partnerships.js";
import { createProject } from "./projects.js";
import {
  accounts,
  auditLog,
  categories,
  entries,
  partnerships,
} from "./schema.js";
import {
  connectAsApp,
  pgErrorCode,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

// Accounts and categories are the partnership's own lists (plan section 8).
// Entries point at them and never change, so a row is archived, never
// deleted (migration 0016).
let t: TestDatabase;
let app: AppConnection;
beforeAll(async () => {
  t = await startTestDatabase();
  app = await connectAsApp(t);
});
afterAll(async () => {
  await app?.db.$client.end();
  await t?.stop();
});

async function seedPartnership(): Promise<string> {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Test" })
    .returning();
  return p!.id;
}

const tables = [
  { label: "accounts", table: accounts },
  { label: "categories", table: categories },
] as const;

describe.each(tables)("$label", ({ table }) => {
  /** A row the app user writes, as the API will. */
  const insert = (partnershipId: string, name: string) =>
    app.db.insert(table).values({ partnershipId, name }).returning();

  // SQLSTATE 23505 unique_violation.
  it("refuses a name the partnership already has", async () => {
    const partnershipId = await seedPartnership();
    await insert(partnershipId, "Caixa");
    expect(await pgErrorCode(insert(partnershipId, "Caixa"))).toBe("23505");
  });

  it("accepts the same name in another partnership", async () => {
    await insert(await seedPartnership(), "Caixa");
    expect(await pgErrorCode(insert(await seedPartnership(), "Caixa"))).toBe(
      "no error",
    );
  });

  // SQLSTATE 23514 check_violation.
  it.each([
    ["an empty name", ""],
    ["a space before it", " Caixa"],
    ["a space after it", "Caixa "],
    ["61 characters", "x".repeat(61)],
  ])("refuses %s", async (_, name) => {
    expect(await pgErrorCode(insert(await seedPartnership(), name))).toBe(
      "23514",
    );
  });

  it("accepts 60 characters, counted as characters and not bytes", async () => {
    // "ç" takes 2 bytes in UTF-8: 60 of them are 120 bytes.
    expect(
      await pgErrorCode(insert(await seedPartnership(), "ç".repeat(60))),
    ).toBe("no error");
  });

  it("is created active, and the app archives and restores it", async () => {
    const [row] = await insert(await seedPartnership(), "Caixa");
    expect(row!.archivedAt).toBeNull();

    const at = new Date("2027-01-12T10:00:00Z");
    const [archived] = await app.db
      .update(table)
      .set({ archivedAt: at })
      .where(eq(table.id, row!.id))
      .returning();
    expect(archived!.archivedAt).toEqual(at);

    const [restored] = await app.db
      .update(table)
      .set({ archivedAt: null })
      .where(eq(table.id, row!.id))
      .returning();
    expect(restored!.archivedAt).toBeNull();
  });

  // SQLSTATE 42501 insufficient_privilege: entries may point at the row.
  it("is never deleted by the app", async () => {
    const [row] = await insert(await seedPartnership(), "Caixa");
    expect(
      await pgErrorCode(app.db.delete(table).where(eq(table.id, row!.id))),
    ).toBe("42501");
  });
});

/** A partnership with an admin, who is the actor of every change. */
async function seedActor() {
  const created = await createPartnership(app.db, {
    name: "Test",
    members: [
      { name: "A", role: "admin" },
      { name: "B", role: "admin" },
    ],
    actorId: null,
  });
  return {
    partnershipId: created.id,
    memberId: created.members[0]!.id,
  };
}

type Actor = Awaited<ReturnType<typeof seedActor>>;

/** The audit rows of one account or category, oldest first. */
const auditOf = (entityId: string) =>
  app.db
    .select({
      actorId: auditLog.actorId,
      action: auditLog.action,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));

/** The refusal a promise ends with, or "no refusal". */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no refusal";
  } catch (error) {
    if (error instanceof ChoiceRefused) return error.reason;
    throw error;
  }
}

/** Waits until some session is blocked on a lock, as on a locked row. */
async function waitForALockWait(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const { rows } = await t.db.$client.query(
      "select 1 from pg_stat_activity where wait_event_type = 'Lock'",
    );
    if (rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("no session ever waited on a lock");
}

const kinds: ChoiceKind[] = ["account", "category"];

describe.each(kinds)("a %s", (kind) => {
  it("is created with its name trimmed, and audited", async () => {
    const actor = await seedActor();
    const created = await createChoice(app.db, actor, kind, "  Caixa  ");
    expect(created.name).toBe("Caixa");
    expect(created.archivedAt).toBeNull();
    expect(await auditOf(created.id)).toEqual([
      {
        actorId: actor.memberId,
        action: `${kind}.create`,
        before: null,
        after: { partnershipId: actor.partnershipId, name: "Caixa" },
      },
    ]);
  });

  it("refuses a name the partnership already has, even with spaces", async () => {
    const actor = await seedActor();
    await createChoice(app.db, actor, kind, "Caixa");
    expect(await refusal(createChoice(app.db, actor, kind, " Caixa "))).toBe(
      "name-taken",
    );
  });

  // A brick takes 2 UTF-16 units: 60 of them are 120 for .length.
  it("accepts 60 characters, as the database counts them", async () => {
    const actor = await seedActor();
    const name = "🧱".repeat(60);
    expect((await createChoice(app.db, actor, kind, name)).name).toBe(name);
  });

  // The API checks the length first; one that gets here is a bug.
  it.each([
    ["blank", "   "],
    ["too long", "x".repeat(61)],
  ])("throws on a %s name", async (_, name) => {
    const actor = await seedActor();
    await expect(createChoice(app.db, actor, kind, name)).rejects.toThrow(
      RangeError,
    );
  });

  it("is renamed, and audited with the old and the new name", async () => {
    const actor = await seedActor();
    const { id } = await createChoice(app.db, actor, kind, "Caixa");
    const other = await createChoice(app.db, actor, kind, "Banco");
    const renamed = await renameChoice(app.db, actor, kind, id, " Cofre ");
    expect(renamed).toEqual({ id, name: "Cofre", archivedAt: null });
    // Only that one: the other keeps its name.
    expect(await listChoices(app.db, actor.partnershipId, kind)).toEqual([
      other,
      renamed,
    ]);
    expect((await auditOf(id)).slice(1)).toEqual([
      {
        actorId: actor.memberId,
        action: `${kind}.rename`,
        before: { name: "Caixa" },
        after: { name: "Cofre" },
      },
    ]);
  });

  it("keeps the name it already has, without an audit row", async () => {
    const actor = await seedActor();
    const { id } = await createChoice(app.db, actor, kind, "Caixa");
    await renameChoice(app.db, actor, kind, id, "Caixa");
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("waits for a change in flight, and audits the name it left", async () => {
    const actor = await seedActor();
    const { id } = await createChoice(app.db, actor, kind, "Caixa");
    const table = kind === "account" ? accounts : categories;
    let pending: Promise<unknown> | undefined;
    await t.db.transaction(async (tx) => {
      await tx.update(table).set({ name: "Cofre" }).where(eq(table.id, id));
      pending = renameChoice(app.db, actor, kind, id, "Banco");
      await waitForALockWait();
    });
    await pending;
    expect((await auditOf(id)).at(-1)!.before).toEqual({ name: "Cofre" });
  });

  it("refuses a rename to a name the partnership already has", async () => {
    const actor = await seedActor();
    await createChoice(app.db, actor, kind, "Caixa");
    const { id } = await createChoice(app.db, actor, kind, "Cofre");
    expect(await refusal(renameChoice(app.db, actor, kind, id, "Caixa"))).toBe(
      "name-taken",
    );
  });

  it("is archived and restored, each audited once", async () => {
    const actor = await seedActor();
    const { id } = await createChoice(app.db, actor, kind, "Caixa");
    const archived = await archiveChoice(app.db, actor, kind, id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    // Archiving it again keeps the moment it left the buttons.
    expect(await archiveChoice(app.db, actor, kind, id)).toEqual(archived);

    const restored = await restoreChoice(app.db, actor, kind, id);
    expect(restored).toEqual({ id, name: "Caixa", archivedAt: null });
    expect(await restoreChoice(app.db, actor, kind, id)).toEqual(restored);

    const audit = await auditOf(id);
    expect(audit.map((a) => a.action)).toEqual([
      `${kind}.create`,
      `${kind}.archive`,
      `${kind}.restore`,
    ]);
    const at = archived.archivedAt!.toISOString();
    expect(audit[1]).toEqual({
      actorId: actor.memberId,
      action: `${kind}.archive`,
      before: { archivedAt: null },
      after: { archivedAt: at },
    });
    expect(audit[2]).toEqual({
      actorId: actor.memberId,
      action: `${kind}.restore`,
      before: { archivedAt: at },
      after: { archivedAt: null },
    });
  });

  // The id comes from the request: one of another partnership is not
  // found, the same as one that doesn't exist.
  it.each([
    [
      "rename",
      (a: Actor, id: string) => renameChoice(app.db, a, kind, id, "X"),
    ],
    ["archive", (a: Actor, id: string) => archiveChoice(app.db, a, kind, id)],
    ["restore", (a: Actor, id: string) => restoreChoice(app.db, a, kind, id)],
  ])("refuses to %s one of another partnership", async (_, change) => {
    const owner = await seedActor();
    const { id } = await createChoice(app.db, owner, kind, "Caixa");
    expect(await refusal(change(await seedActor(), id))).toBe("not-found");
    expect(await auditOf(id)).toHaveLength(1);
  });

  it("lists the partnership's own, by name, the archived ones on request", async () => {
    const actor = await seedActor();
    await createChoice(app.db, await seedActor(), kind, "Outra");
    const b = await createChoice(app.db, actor, kind, "Banco");
    const a = await createChoice(app.db, actor, kind, "Areia");
    const c = await archiveChoice(
      app.db,
      actor,
      kind,
      (await createChoice(app.db, actor, kind, "Caixa")).id,
    );
    expect(await listChoices(app.db, actor.partnershipId, kind)).toEqual([
      a,
      b,
    ]);
    expect(
      await listChoices(app.db, actor.partnershipId, kind, {
        includeArchived: true,
      }),
    ).toEqual([a, b, c]);
  });
});

describe("archiving an account", () => {
  /** A project weighing the actor alone, and money moved by the owner. */
  async function seedProject(actor: Actor, startsOn: string) {
    const { id } = await createProject(app.db, {
      partnershipId: actor.partnershipId,
      name: "Casa",
      kind: "construction",
      startsOn,
      weights: [{ memberId: actor.memberId, weight: 1 }],
      actorId: null,
    });
    const base = {
      projectId: id,
      occurredOn: startsOn,
      accrualOn: startsOn,
      authorId: actor.memberId,
      source: "app" as const,
    };
    return {
      contribute: (accountId: string, amount: bigint) =>
        t.db.insert(entries).values({
          ...base,
          type: "contribution",
          amount,
          fromMemberId: actor.memberId,
          toAccountId: accountId,
        }),
      transfer: (from: string, to: string, amount: bigint) =>
        t.db.insert(entries).values({
          ...base,
          type: "transfer",
          amount,
          fromAccountId: from,
          toAccountId: to,
        }),
    };
  }

  it("refuses while it holds money, and accepts once it is moved out", async () => {
    const actor = await seedActor();
    const box = await createChoice(app.db, actor, "account", "Caixa");
    const bank = await createChoice(app.db, actor, "account", "Banco");
    const project = await seedProject(actor, "2027-01-11");
    await project.contribute(box.id, 10000n);
    expect(await refusal(archiveChoice(app.db, actor, "account", box.id))).toBe(
      "account-not-empty",
    );

    await project.transfer(box.id, bank.id, 10000n);
    expect(
      (await archiveChoice(app.db, actor, "account", box.id)).archivedAt,
    ).toBeInstanceOf(Date);
    expect(
      await refusal(archiveChoice(app.db, actor, "account", bank.id)),
    ).toBe("account-not-empty");
  });

  it("counts every project of the partnership, not only the newest", async () => {
    const actor = await seedActor();
    const box = await createChoice(app.db, actor, "account", "Caixa");
    const older = await seedProject(actor, "2027-01-11");
    await older.contribute(box.id, 10000n);
    await seedProject(actor, "2028-01-10");
    expect(await refusal(archiveChoice(app.db, actor, "account", box.id))).toBe(
      "account-not-empty",
    );
    const [row] = await app.db
      .select({ archivedAt: accounts.archivedAt })
      .from(accounts)
      .where(inArray(accounts.id, [box.id]));
    expect(row!.archivedAt).toBeNull();
  });

  it("accepts money put in during one project and moved out in the next", async () => {
    const actor = await seedActor();
    const box = await createChoice(app.db, actor, "account", "Caixa");
    const bank = await createChoice(app.db, actor, "account", "Banco");
    await (await seedProject(actor, "2027-01-11")).contribute(box.id, 10000n);
    await (
      await seedProject(actor, "2028-01-10")
    ).transfer(box.id, bank.id, 10000n);
    expect(
      (await archiveChoice(app.db, actor, "account", box.id)).archivedAt,
    ).toBeInstanceOf(Date);
  });

  // The ledger never lets an account go below zero; if one ever did, it
  // would still hold a balance to be explained, not an empty account.
  it("refuses an overdrawn one too", async () => {
    const actor = await seedActor();
    const box = await createChoice(app.db, actor, "account", "Caixa");
    const bank = await createChoice(app.db, actor, "account", "Banco");
    await (
      await seedProject(actor, "2027-01-11")
    ).transfer(box.id, bank.id, 10000n);
    expect(await refusal(archiveChoice(app.db, actor, "account", box.id))).toBe(
      "account-not-empty",
    );
  });
});
