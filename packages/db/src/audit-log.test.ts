import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "./schema.js";
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

/** An audit row of a command run on the server (no actor). */
async function seedAudit() {
  const [row] = await t.db
    .insert(auditLog)
    .values({
      action: "invite.create",
      entityId: "01900000-0000-7000-8000-000000000000",
      after: { role: "admin" },
    })
    .returning();
  return row!;
}

// SQLSTATE 23001 restrict_violation, raised by refuse_audit_change().
describe("the audit log is insert-only", () => {
  it("accepts a new row", async () => {
    const row = await seedAudit();
    expect(row.after).toEqual({ role: "admin" });
  });

  it("refuses an UPDATE", async () => {
    const row = await seedAudit();
    const update = t.db
      .update(auditLog)
      .set({ after: null })
      .where(eq(auditLog.id, row.id));
    expect(await pgErrorCode(update)).toBe("23001");
  });

  it("refuses a DELETE", async () => {
    const row = await seedAudit();
    const remove = t.db.delete(auditLog).where(eq(auditLog.id, row.id));
    expect(await pgErrorCode(remove)).toBe("23001");
  });

  it("refuses a TRUNCATE", async () => {
    await seedAudit();
    const truncate = t.db.execute(sql`truncate audit_log`);
    expect(await pgErrorCode(truncate)).toBe("23001");
  });
});

describe("audit actions", () => {
  it.each(["entry.record", "session.revoke", "member_role.change"])(
    "accepts %s",
    async (action) => {
      const insert = t.db
        .insert(auditLog)
        .values({ action, entityId: "01900000-0000-7000-8000-000000000000" });
      expect(await pgErrorCode(insert)).toBe("no error");
    },
  );

  it.each(["record", "Entry.Record", "entry.record.again", "entry."])(
    "refuses %s",
    async (action) => {
      const insert = t.db
        .insert(auditLog)
        .values({ action, entityId: "01900000-0000-7000-8000-000000000000" });
      expect(await pgErrorCode(insert)).toBe("23514");
    },
  );
});
