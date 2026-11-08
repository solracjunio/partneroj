import { eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installJobQueue, queues, startJobQueue } from "./jobs.js";
import { recordEntry } from "./record-entry.js";
import {
  auditLog,
  entries,
  members,
  partnerships,
  projects,
} from "./schema.js";
import {
  connectAsApp,
  pgErrorCode,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

// The app connects as a member of partneroj_app (migration 0006). These
// tests run every statement as that user, never as the owner.
let t: TestDatabase;
let app: AppConnection;
let boss: PgBoss;
beforeAll(async () => {
  t = await startTestDatabase();
  // As at deploy: the owner installs pg-boss, then the app runs it.
  await installJobQueue(t.connectionString);
  app = await connectAsApp(t);
  boss = await startJobQueue(app.connectionString);
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await app?.db.$client.end();
  await t?.stop();
});

/** Records an expense through the same path the API will use. */
async function recordExpense() {
  const [p] = await app.db
    .insert(partnerships)
    .values({ name: "Test" })
    .returning();
  const [project] = await app.db
    .insert(projects)
    .values({
      partnershipId: p!.id,
      name: "House",
      kind: "construction",
      startsOn: "2027-01-11",
    })
    .returning();
  const [member] = await app.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "A", role: "admin" })
    .returning();
  return recordEntry(app.db, boss, {
    projectId: project!.id,
    type: "expense",
    amount: 15000n,
    occurredOn: "2027-01-12",
    accrualOn: "2027-01-12",
    fromMemberId: member!.id,
    authorId: member!.id,
    source: "app",
  });
}

const run = (query: string) => app.db.execute(sql.raw(query));

describe("the app user can do its work", () => {
  it("records an entry with its feed, audit row and job", async () => {
    const entry = await recordExpense();
    const audit = await app.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, entry.id));
    expect(audit).toHaveLength(1);
    const jobs = await boss.findJobs(queues.entryNotification, {
      data: { entryId: entry.id },
    });
    expect(jobs).toHaveLength(1);
  });

  // pg-boss's maintenance creates a partition of queue_stats each day,
  // which needs ownership of queue_stats.
  it("creates a queue_stats partition, as pg-boss does", async () => {
    const partition = run(
      "create table pgboss.queue_stats_29991231 partition of pgboss.queue_stats" +
        " for values from ('2999-12-31 00:00:00+00') to ('3000-01-01 00:00:00+00')",
    );
    expect(await pgErrorCode(partition)).toBe("no error");
  });

  // consumeInvite and session revocation are UPDATEs.
  it.each(["invites", "sessions"])("updates %s", async (table) => {
    expect(
      await pgErrorCode(
        run(`update ${table} set revoked_at = now() where false`),
      ),
    ).toBe("no error");
  });
});

// SQLSTATE 42501 insufficient_privilege: refused before any trigger runs.
describe("the app user cannot change the record", () => {
  it.each([
    "update entries set description = 'x' where false",
    "delete from entries where false",
    "truncate entries",
    "update audit_log set after = null where false",
    "delete from audit_log where false",
    "truncate audit_log",
  ])("%s", async (query) => {
    expect(await pgErrorCode(run(query))).toBe("42501");
  });

  // Only the owner can alter a table, so the triggers stay on.
  it.each([
    "alter table entries disable trigger entries_immutable",
    "drop trigger audit_log_insert_only on audit_log",
    "alter table audit_log owner to partneroj_test_app",
  ])("%s", async (query) => {
    expect(await pgErrorCode(run(query))).toBe("42501");
  });

  it("cannot create tables next to the data", async () => {
    expect(await pgErrorCode(run("create table public.x (id int)"))).toBe(
      "42501",
    );
  });

  it("cannot read the migration history", async () => {
    expect(
      await pgErrorCode(run("select * from drizzle.__drizzle_migrations")),
    ).toBe("42501");
  });
});

describe("the owner is unchanged", () => {
  it("still hits the trigger, not a privilege error", async () => {
    const entry = await recordExpense();
    const remove = t.db.delete(entries).where(eq(entries.id, entry.id));
    expect(await pgErrorCode(remove)).toBe("23001");
  });
});
