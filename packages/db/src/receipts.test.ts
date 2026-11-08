import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  entries,
  members,
  partnerships,
  projects,
  receipts,
} from "./schema.js";
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

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** An expense and a valid receipt for it, not inserted yet. */
async function newReceipt() {
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
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "A", role: "admin" })
    .returning();
  const [expense] = await t.db
    .insert(entries)
    .values({
      projectId: project!.id,
      type: "expense",
      amount: 15000n,
      occurredOn: "2027-01-12",
      accrualOn: "2027-01-12",
      fromMemberId: member!.id,
      authorId: member!.id,
      source: "app",
    })
    .returning();
  return {
    entryId: expense!.id,
    storageKey: `receipts/${crypto.randomUUID()}.jpg`,
    contentType: "image/jpeg",
    sizeBytes: 250_000,
    sha256: sha256(crypto.randomUUID()),
    uploadedBy: member!.id,
  } satisfies typeof receipts.$inferInsert;
}

// SQLSTATE codes: 23514 check_violation, 23505 unique_violation.
describe("receipts", () => {
  it("stores a receipt", async () => {
    const receipt = await newReceipt();
    expect(await pgErrorCode(t.db.insert(receipts).values(receipt))).toBe(
      "no error",
    );
  });

  it("refuses the same file twice on an entry", async () => {
    const receipt = await newReceipt();
    await t.db.insert(receipts).values(receipt);
    const again = t.db
      .insert(receipts)
      .values({ ...receipt, storageKey: `${receipt.storageKey}.copy` });
    expect(await pgErrorCode(again)).toBe("23505");
  });

  it("refuses a file type that is not allowed", async () => {
    const receipt = await newReceipt();
    const insert = t.db
      .insert(receipts)
      .values({ ...receipt, contentType: "text/html" });
    expect(await pgErrorCode(insert)).toBe("23514");
  });

  it("refuses an empty or oversized file", async () => {
    const receipt = await newReceipt();
    for (const sizeBytes of [0, 10_485_761]) {
      const insert = t.db.insert(receipts).values({ ...receipt, sizeBytes });
      expect(await pgErrorCode(insert)).toBe("23514");
    }
  });

  it("refuses a hash that is not lowercase SHA-256 hex", async () => {
    const receipt = await newReceipt();
    const insert = t.db
      .insert(receipts)
      .values({ ...receipt, sha256: receipt.sha256.toUpperCase() });
    expect(await pgErrorCode(insert)).toBe("23514");
  });
});
