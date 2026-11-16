import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPartnership,
  listMembers,
  setEntryBallotRule,
} from "./partnerships.js";
import { auditLog, partnerships } from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

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

async function ruleOf(partnershipId: string) {
  const [row] = await t.db
    .select({ rule: partnerships.entryBallotRule })
    .from(partnerships)
    .where(eq(partnerships.id, partnershipId));
  return row!.rule;
}

const twoAdmins = [
  { name: "João", role: "admin" as const },
  { name: "Maria", role: "admin" as const },
];

describe("createPartnership", () => {
  it("creates the partnership with its first members", async () => {
    const created = await createPartnership(app.db, {
      name: " Obra Teste ",
      members: [...twoAdmins, { name: "Ana", role: "reader" }],
      actorId: null,
    });
    expect(created.members.map((m) => [m.name, m.role])).toEqual([
      ["João", "admin"],
      ["Maria", "admin"],
      ["Ana", "reader"],
    ]);
    const listed = await listMembers(app.db);
    expect(listed).toContainEqual(
      expect.objectContaining({ name: "Ana", partnershipName: "Obra Teste" }),
    );
  });

  it("audits the partnership and each member as a server command", async () => {
    const created = await createPartnership(app.db, {
      name: "Obra Auditada",
      members: twoAdmins,
      actorId: null,
    });
    const ids = [created.id, ...created.members.map((m) => m.id)];
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(inArray(auditLog.entityId, ids));
    expect(rows.map((r) => r.action).sort()).toEqual([
      "member.create",
      "member.create",
      "partnership.create",
    ]);
    expect(rows.every((r) => r.actorId === null)).toBe(true);
  });

  it("decides ballots on entries by majority, unless told otherwise", async () => {
    const byDefault = await createPartnership(app.db, {
      name: "Obra Padrão",
      members: twoAdmins,
      actorId: null,
    });
    const unanimous = await createPartnership(app.db, {
      name: "Obra Unânime",
      members: twoAdmins,
      entryBallotRule: "unanimity",
      actorId: null,
    });
    expect(await ruleOf(byDefault.id)).toBe("majority");
    expect(await ruleOf(unanimous.id)).toBe("unanimity");
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, unanimous.id));
    expect(audit!.after).toEqual({
      name: "Obra Unânime",
      entryBallotRule: "unanimity",
    });
  });

  it("refuses fewer than 2 admins and writes nothing", async () => {
    await expect(
      createPartnership(app.db, {
        name: "Obra Sozinha",
        members: [
          { name: "João", role: "admin" },
          { name: "Maria", role: "partner" },
        ],
        actorId: null,
      }),
    ).rejects.toThrow("at least 2 admins");
    const listed = await listMembers(app.db);
    expect(listed.some((m) => m.partnershipName === "Obra Sozinha")).toBe(
      false,
    );
  });

  it("refuses two members with the same name", async () => {
    await expect(
      createPartnership(app.db, {
        name: "Obra Repetida",
        members: [...twoAdmins, { name: "João ", role: "partner" }],
        actorId: null,
      }),
    ).rejects.toThrow("same name");
  });

  it("rolls back the partnership when a member fails", async () => {
    const before = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "partnership.create"));
    await expect(
      createPartnership(app.db, {
        name: "Obra Quebrada",
        // Not a member_role: the insert fails after the partnership's.
        members: [...twoAdmins, { name: "Ana", role: "owner" as "admin" }],
        actorId: null,
      }),
    ).rejects.toThrow();
    const after = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "partnership.create"));
    expect(after).toHaveLength(before.length);
  });
});

describe("setEntryBallotRule", () => {
  const ruleChanges = (partnershipId: string) =>
    t.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, partnershipId),
          eq(auditLog.action, "partnership.set_entry_ballot_rule"),
        ),
      );

  it("changes the rule and audits it as a server command, before and after", async () => {
    const p = await createPartnership(app.db, {
      name: "Obra Mudada",
      members: twoAdmins,
      actorId: null,
    });
    const changed = await setEntryBallotRule(app.db, {
      partnershipId: p.id,
      rule: "unanimity",
      actorId: null,
    });
    expect(changed).toEqual({ before: "majority", after: "unanimity" });
    expect(await ruleOf(p.id)).toBe("unanimity");
    const rows = await ruleChanges(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: null,
      before: { entryBallotRule: "majority" },
      after: { entryBallotRule: "unanimity" },
    });
  });

  it("writes nothing when the rule is already the one asked", async () => {
    const p = await createPartnership(app.db, {
      name: "Obra Igual",
      members: twoAdmins,
      actorId: null,
    });
    const unchanged = await setEntryBallotRule(app.db, {
      partnershipId: p.id,
      rule: "majority",
      actorId: null,
    });
    expect(unchanged).toEqual({ before: "majority", after: "majority" });
    expect(await ruleChanges(p.id)).toHaveLength(0);
  });

  it("changes only that partnership", async () => {
    const p = await createPartnership(app.db, {
      name: "Obra Escolhida",
      members: twoAdmins,
      actorId: null,
    });
    const other = await createPartnership(app.db, {
      name: "Obra Vizinha",
      members: twoAdmins,
      actorId: null,
    });
    await setEntryBallotRule(app.db, {
      partnershipId: p.id,
      rule: "unanimity",
      actorId: null,
    });
    expect(await ruleOf(other.id)).toBe("majority");
  });

  it("refuses a partnership that doesn't exist", async () => {
    await expect(
      setEntryBallotRule(app.db, {
        partnershipId: "0190f0f0-0000-7000-8000-000000000000",
        rule: "unanimity",
        actorId: null,
      }),
    ).rejects.toThrow("no partnership");
  });
});
