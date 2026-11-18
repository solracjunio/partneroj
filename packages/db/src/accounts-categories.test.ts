import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, categories, partnerships } from "./schema.js";
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
