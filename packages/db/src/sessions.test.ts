import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptInvite, createInvite } from "./invites.js";
import { auditLog, members, partnerships, sessions } from "./schema.js";
import { findSession, revokeSessions, SESSION_IDLE_DAYS } from "./sessions.js";
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

/** A member who accepted an invite; returns the session token. */
async function signedIn(): Promise<{
  memberId: string;
  partnershipId: string;
  sessionToken: string;
}> {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "João", role: "admin" })
    .returning();
  const { token } = await createInvite(app.db, {
    memberId: member!.id,
    createdBy: null,
  });
  const accepted = await acceptInvite(app.db, token);
  return {
    memberId: member!.id,
    partnershipId: p!.id,
    sessionToken: accepted!.sessionToken,
  };
}

describe("findSession", () => {
  it("returns the member behind a session token", async () => {
    const { memberId, partnershipId, sessionToken } = await signedIn();
    expect(await findSession(app.db, sessionToken)).toMatchObject({
      memberId,
      partnershipId,
      name: "João",
      role: "admin",
    });
  });

  it("returns null for an unknown token", async () => {
    expect(await findSession(app.db, "nope")).toBeNull();
  });

  it("returns null for a revoked session", async () => {
    const { memberId, sessionToken } = await signedIn();
    await t.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.memberId, memberId));
    expect(await findSession(app.db, sessionToken)).toBeNull();
  });

  it("ends a session left unused for too long", async () => {
    const { memberId, sessionToken } = await signedIn();
    await t.db
      .update(sessions)
      .set({
        lastUsedAt: sql`now() - make_interval(days => ${SESSION_IDLE_DAYS + 1})`,
      })
      .where(eq(sessions.memberId, memberId));
    expect(await findSession(app.db, sessionToken)).toBeNull();
  });

  it("keeps a used session alive", async () => {
    const { memberId, sessionToken } = await signedIn();
    await t.db
      .update(sessions)
      .set({
        lastUsedAt: sql`now() - make_interval(days => ${SESSION_IDLE_DAYS - 1})`,
      })
      .where(eq(sessions.memberId, memberId));
    expect(await findSession(app.db, sessionToken)).not.toBeNull();

    const [row] = await t.db
      .select({
        idleSeconds: sql<number>`extract(epoch from now() - ${sessions.lastUsedAt})`,
      })
      .from(sessions)
      .where(eq(sessions.memberId, memberId));
    expect(Number(row!.idleSeconds)).toBeLessThan(60);
  });
});

describe("revokeSessions", () => {
  it("ends every live session of the member", async () => {
    const { memberId, partnershipId, sessionToken } = await signedIn();
    const revoked = await revokeSessions(app.db, {
      actorId: memberId,
      partnershipId,
      memberId,
    });
    expect(revoked).toBe(1);
    expect(await findSession(app.db, sessionToken)).toBeNull();
  });

  it("audits which sessions were ended", async () => {
    const { memberId, partnershipId } = await signedIn();
    await revokeSessions(app.db, {
      actorId: memberId,
      partnershipId,
      memberId,
    });
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "session.revoke"))
      .orderBy(desc(auditLog.id))
      .limit(1);
    const [session] = await t.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.memberId, memberId));
    expect(audit).toMatchObject({
      actorId: memberId,
      entityId: memberId,
      after: { sessionIds: [session!.id] },
    });
  });

  it("refuses a member of another partnership", async () => {
    const admin = await signedIn();
    const other = await signedIn();
    const revoked = await revokeSessions(app.db, {
      actorId: admin.memberId,
      partnershipId: admin.partnershipId,
      memberId: other.memberId,
    });
    expect(revoked).toBeNull();
    expect(await findSession(app.db, other.sessionToken)).not.toBeNull();
  });
});
