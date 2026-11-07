import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { members, partnerships, projects, weights } from "./schema.js";
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

/** A partnership with one project and two members, no weights yet. */
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
  const [a, b] = await t.db
    .insert(members)
    .values([
      { partnershipId: p!.id, name: "A", role: "admin" },
      { partnershipId: p!.id, name: "B", role: "partner" },
    ])
    .returning();
  return { projectId: project!.id, a: a!.id, b: b!.id };
}

// SQLSTATE codes: 23514 check_violation, 23505 unique_violation.
describe("weights", () => {
  it("stores weights in draw order", async () => {
    const { projectId, a, b } = await seed();
    await t.db.insert(weights).values([
      { projectId, memberId: a, weight: 1, drawPosition: 1 },
      { projectId, memberId: b, weight: 2, drawPosition: 0 },
    ]);
    const rows = await t.db.query.weights.findMany({
      where: (s, { eq }) => eq(s.projectId, projectId),
      orderBy: (s, { asc }) => asc(s.drawPosition),
    });
    expect(rows.map((s) => s.memberId)).toEqual([b, a]);
  });

  it("refuses a weight below 1", async () => {
    const { projectId, a } = await seed();
    const insert = t.db
      .insert(weights)
      .values({ projectId, memberId: a, weight: 0, drawPosition: 0 });
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("refuses the same member twice in a project", async () => {
    const { projectId, a } = await seed();
    const insert = t.db.insert(weights).values([
      { projectId, memberId: a, weight: 1, drawPosition: 0 },
      { projectId, memberId: a, weight: 1, drawPosition: 1 },
    ]);
    expect(await pgErrorCode(insert)).toBe("23505");
  });

  it("refuses two members with the same draw position", async () => {
    const { projectId, a, b } = await seed();
    const insert = t.db.insert(weights).values([
      { projectId, memberId: a, weight: 1, drawPosition: 0 },
      { projectId, memberId: b, weight: 1, drawPosition: 0 },
    ]);
    expect(await pgErrorCode(insert)).toBe("23505");
  });
});
