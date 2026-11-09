import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptInvite, createInvite } from "./invites.js";
import { members, partnerships, sessions } from "./schema.js";
import { findSession, SESSION_IDLE_DAYS } from "./sessions.js";
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
