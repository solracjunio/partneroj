import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLedger } from "./ledger.js";
import { entries, members, partnerships, periods, projects } from "./schema.js";
import {
  connectAsApp,
  pgErrorCode,
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

/** An ongoing project, settled month by month, and its admin. */
async function seedProject() {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Test" })
    .returning();
  const [project] = await t.db
    .insert(projects)
    .values({
      partnershipId: p!.id,
      name: "Rent",
      kind: "ongoing",
      startsOn: "2027-01-01",
    })
    .returning();
  const [admin] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "A", role: "admin" })
    .returning();
  return { projectId: project!.id, adminId: admin!.id };
}

const march = { startsOn: "2027-03-01", endsOn: "2027-03-31" };

describe("periods", () => {
  it("are created open, and the app closes them", async () => {
    const { projectId, adminId } = await seedProject();
    const [period] = await app.db
      .insert(periods)
      .values({ projectId, ...march })
      .returning();
    expect(period!.closedAt).toBeNull();
    const close = app.db
      .update(periods)
      .set({ closedBy: adminId, closedAt: new Date() })
      .where(eq(periods.id, period!.id));
    expect(await pgErrorCode(close)).toBe("no error");
  });

  // SQLSTATE 23514 check_violation.
  it("refuses a period that ends before it starts", async () => {
    const { projectId } = await seedProject();
    const insert = t.db
      .insert(periods)
      .values({ projectId, startsOn: "2027-03-31", endsOn: "2027-03-01" });
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("records who closed it and when, both or neither", async () => {
    const { projectId, adminId } = await seedProject();
    expect(
      await pgErrorCode(
        t.db
          .insert(periods)
          .values({ projectId, ...march, closedAt: new Date() }),
      ),
    ).toBe("23514");
    expect(
      await pgErrorCode(
        t.db.insert(periods).values({ projectId, ...march, closedBy: adminId }),
      ),
    ).toBe("23514");
  });

  // SQLSTATE 23P01 exclusion_violation: a day belongs to one period only.
  it("refuses a period that overlaps another of the same project", async () => {
    const { projectId } = await seedProject();
    await t.db.insert(periods).values({ projectId, ...march });
    const overlap = t.db
      .insert(periods)
      .values({ projectId, startsOn: "2027-03-31", endsOn: "2027-04-30" });
    expect(await pgErrorCode(overlap)).toBe("23P01");
  });

  it("accepts the next period, and the same days in another project", async () => {
    const { projectId } = await seedProject();
    await t.db.insert(periods).values({ projectId, ...march });
    const next = t.db
      .insert(periods)
      .values({ projectId, startsOn: "2027-04-01", endsOn: "2027-04-30" });
    expect(await pgErrorCode(next)).toBe("no error");
    const other = await seedProject();
    const same = t.db
      .insert(periods)
      .values({ projectId: other.projectId, ...march });
    expect(await pgErrorCode(same)).toBe("no error");
  });
});

// SQLSTATE 23001 restrict_violation, raised by refuse_period_change(): a
// period only goes from open to closed, once (plan section 3).
describe("a closed period never changes", () => {
  async function seedClosed() {
    const { projectId, adminId } = await seedProject();
    const [period] = await t.db
      .insert(periods)
      .values({ projectId, ...march, closedBy: adminId, closedAt: new Date() })
      .returning();
    return { period: period!, adminId };
  }

  it("refuses reopening it", async () => {
    const { period } = await seedClosed();
    const reopen = t.db
      .update(periods)
      .set({ closedBy: null, closedAt: null })
      .where(eq(periods.id, period.id));
    expect(await pgErrorCode(reopen)).toBe("23001");
  });

  it("refuses closing it again, by someone else or at another time", async () => {
    const { period } = await seedClosed();
    const { adminId: other } = await seedProject();
    const again = t.db
      .update(periods)
      .set({ closedBy: other, closedAt: new Date() })
      .where(eq(periods.id, period.id));
    expect(await pgErrorCode(again)).toBe("23001");
  });

  it("refuses changing its days, even while open", async () => {
    const { projectId } = await seedProject();
    const [open] = await t.db
      .insert(periods)
      .values({ projectId, ...march })
      .returning();
    const move = t.db
      .update(periods)
      .set({ endsOn: "2027-04-15" })
      .where(eq(periods.id, open!.id));
    expect(await pgErrorCode(move)).toBe("23001");
    // Nor in the same UPDATE that closes it.
    const other = await seedProject();
    for (const change of [
      { startsOn: "2027-02-15" },
      { endsOn: "2027-04-15" },
      { projectId: other.projectId },
    ]) {
      const closeAndMove = t.db
        .update(periods)
        .set({ ...change, closedBy: other.adminId, closedAt: new Date() })
        .where(eq(periods.id, open!.id));
      expect(await pgErrorCode(closeAndMove)).toBe("23001");
    }
  });

  it("refuses a DELETE: the owner by the trigger, the app by its privileges", async () => {
    const { period } = await seedClosed();
    expect(
      await pgErrorCode(t.db.delete(periods).where(eq(periods.id, period.id))),
    ).toBe("23001");
    // 42501 insufficient_privilege: refused before the trigger runs.
    expect(
      await pgErrorCode(
        app.db.delete(periods).where(eq(periods.id, period.id)),
      ),
    ).toBe("42501");
    expect(await pgErrorCode(t.db.execute(sql`truncate periods cascade`))).toBe(
      "23001",
    );
  });
});

describe("loadLedger", () => {
  it("gives each entry its accrual day, which says its period", async () => {
    const { projectId, adminId } = await seedProject();
    await t.db.insert(entries).values({
      projectId,
      type: "expense",
      amount: 15000n,
      occurredOn: "2027-04-02",
      accrualOn: "2027-03-31",
      fromMemberId: adminId,
      authorId: adminId,
      source: "app",
    });
    const { entries: ledger } = await loadLedger(t.db, projectId);
    expect(ledger.map((e) => e.accrualOn)).toEqual(["2027-03-31"]);
  });
});
