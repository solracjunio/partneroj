import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPartnership, listMembers } from "./partnerships.js";
import { auditLog } from "./schema.js";
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
