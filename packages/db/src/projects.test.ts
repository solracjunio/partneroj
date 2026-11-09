import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPartnership } from "./partnerships.js";
import {
  addCategories,
  createProject,
  drawOrder,
  listProjects,
} from "./projects.js";
import { auditLog, categories, projects, weights } from "./schema.js";
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

/** Two admins, a partner and a reader. */
async function newPartnership(name = "Obra Teste") {
  const created = await createPartnership(app.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Ana", role: "partner" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, maria, ana, leo] = created.members.map((m) => m.id);
  return { id: created.id, joao: joao!, maria: maria!, ana: ana!, leo: leo! };
}

const project = (
  partnershipId: string,
  w: { memberId: string; weight: number }[],
) =>
  createProject(app.db, {
    partnershipId,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: w,
    actorId: null,
  });

describe("drawOrder", () => {
  it("is a permutation of 1..n", () => {
    for (let n = 1; n <= 6; n++) {
      expect([...drawOrder(n)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: n }, (_, i) => i + 1),
      );
    }
  });

  it("is not always the same order", () => {
    const seen = new Set(Array.from({ length: 50 }, () => drawOrder(3).join()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("createProject", () => {
  it("stores every weight with a drawn position", async () => {
    const p = await newPartnership();
    const created = await project(p.id, [
      { memberId: p.joao, weight: 1 },
      { memberId: p.maria, weight: 1 },
      { memberId: p.ana, weight: 2 },
    ]);
    const rows = await t.db
      .select()
      .from(weights)
      .where(eq(weights.projectId, created.id));
    expect(rows.map((r) => r.weight).sort()).toEqual([1, 1, 2]);
    expect(rows.map((r) => r.drawPosition).sort()).toEqual([1, 2, 3]);
  });

  it("audits the project with its weights as a server command", async () => {
    const p = await newPartnership();
    const created = await project(p.id, [
      { memberId: p.joao, weight: 1 },
      { memberId: p.maria, weight: 1 },
    ]);
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, created.id));
    expect(audit).toMatchObject({ actorId: null, action: "project.create" });
    expect((audit!.after as { weights: unknown[] }).weights).toHaveLength(2);
  });

  it("refuses a reader, writing nothing", async () => {
    const p = await newPartnership("Obra Leitor");
    await expect(
      project(p.id, [
        { memberId: p.joao, weight: 1 },
        { memberId: p.leo, weight: 1 },
      ]),
    ).rejects.toThrow("partner or admin of this partnership");
    const rows = await t.db
      .select()
      .from(projects)
      .where(eq(projects.partnershipId, p.id));
    expect(rows).toEqual([]);
  });

  it("refuses a member of another partnership", async () => {
    const ours = await newPartnership();
    const theirs = await newPartnership("Outra Obra");
    await expect(
      project(ours.id, [
        { memberId: ours.joao, weight: 1 },
        { memberId: theirs.ana, weight: 1 },
      ]),
    ).rejects.toThrow("partner or admin of this partnership");
  });

  it.each([0, 1.5, -1, Number.NaN])("refuses the weight %s", async (weight) => {
    const p = await newPartnership();
    await expect(project(p.id, [{ memberId: p.joao, weight }])).rejects.toThrow(
      "whole number of at least 1",
    );
  });

  it("refuses a member listed twice", async () => {
    const p = await newPartnership();
    await expect(
      project(p.id, [
        { memberId: p.joao, weight: 1 },
        { memberId: p.joao, weight: 2 },
      ]),
    ).rejects.toThrow("listed twice");
  });

  it("is listed with its partnership", async () => {
    const p = await newPartnership("Obra Listada");
    const created = await project(p.id, [{ memberId: p.ana, weight: 1 }]);
    expect(await listProjects(app.db)).toContainEqual(
      expect.objectContaining({
        id: created.id,
        partnershipName: "Obra Listada",
      }),
    );
  });
});

describe("addCategories", () => {
  it("adds new names and skips the ones it already has", async () => {
    const p = await newPartnership();
    expect(
      await addCategories(app.db, {
        partnershipId: p.id,
        names: ["Material", " Taxas ", "Material"],
        actorId: null,
      }),
    ).toEqual(["Material", "Taxas"]);
    expect(
      await addCategories(app.db, {
        partnershipId: p.id,
        names: ["Taxas", "Outro"],
        actorId: null,
      }),
    ).toEqual(["Outro"]);
    const rows = await t.db
      .select({ name: categories.name })
      .from(categories)
      .where(eq(categories.partnershipId, p.id));
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Material",
      "Outro",
      "Taxas",
    ]);
  });

  it("audits only the new ones", async () => {
    const p = await newPartnership();
    await addCategories(app.db, {
      partnershipId: p.id,
      names: ["Material"],
      actorId: p.joao,
    });
    await addCategories(app.db, {
      partnershipId: p.id,
      names: ["Material"],
      actorId: p.joao,
    });
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorId, p.joao));
    expect(rows.map((r) => r.action)).toEqual(["category.create"]);
  });
});
