import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeAccess } from "./member-access.js";
import {
  auditLog,
  credentials,
  invites,
  members,
  partnerships,
  sessions,
} from "./schema.js";
import {
  connectAsApp,
  startTestDatabase,
  waitForALockWait,
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

/** A fresh base64url value; a uuid without its dashes is one. */
const base64url = () => randomUUID().replaceAll("-", "");
const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

/** A partnership with an admin, "João", and a partner, "Maria". */
async function seed() {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [admin, partner] = await t.db
    .insert(members)
    .values([
      { partnershipId: p!.id, name: "João", role: "admin" },
      { partnershipId: p!.id, name: "Maria", role: "partner" },
    ])
    .returning();
  return { partnershipId: p!.id, adminId: admin!.id, memberId: partner!.id };
}

/** Maria on two phones, each with its passkey, and an invite still pending. */
async function seedAccess(memberId: string) {
  const live = await t.db
    .insert(sessions)
    .values([
      { memberId, refreshTokenHash: base64url() },
      { memberId, refreshTokenHash: base64url() },
    ])
    .returning({ id: sessions.id });
  const passkeys = await t.db
    .insert(credentials)
    .values([
      { memberId, credentialId: base64url(), publicKey: base64url() },
      { memberId, credentialId: base64url(), publicKey: base64url() },
    ])
    .returning({ id: credentials.id });
  const [pending] = await t.db
    .insert(invites)
    .values({ memberId, tokenHash: base64url(), expiresAt: hours(24) })
    .returning({ id: invites.id });
  return {
    sessionIds: live.map((s) => s.id),
    credentialIds: passkeys.map((c) => c.id),
    inviteIds: [pending!.id],
  };
}

/** The ids of the member's rows still without revoked_at. */
async function stillLive(memberId: string) {
  const ids = async (
    table: typeof sessions | typeof credentials | typeof invites,
  ) =>
    (
      await t.db
        .select({ id: table.id, revokedAt: table.revokedAt })
        .from(table)
        .where(eq(table.memberId, memberId))
    )
      .filter((row) => row.revokedAt === null)
      .map((row) => row.id)
      .sort();
  return {
    sessions: await ids(sessions),
    credentials: await ids(credentials),
    invites: await ids(invites),
  };
}

describe("revokeAccess", () => {
  it("ends every session, passkey and pending invite of the member", async () => {
    const { partnershipId, adminId, memberId } = await seed();
    await seedAccess(memberId);

    const revoked = await revokeAccess(app.db, {
      actorId: adminId,
      partnershipId,
      memberId,
    });

    expect(revoked).toEqual({ sessions: 2, passkeys: 2, invites: 1 });
    expect(await stillLive(memberId)).toEqual({
      sessions: [],
      credentials: [],
      invites: [],
    });
  });

  it("counts only what still let the member in", async () => {
    const { partnershipId, adminId, memberId } = await seed();
    const before = new Date(Date.now() - 60_000);
    await t.db.insert(sessions).values({
      memberId,
      refreshTokenHash: base64url(),
      revokedAt: before,
    });
    await t.db.insert(credentials).values({
      memberId,
      credentialId: base64url(),
      publicKey: base64url(),
      revokedAt: before,
    });
    await t.db.insert(invites).values([
      {
        memberId,
        tokenHash: base64url(),
        expiresAt: hours(24),
        usedAt: before,
      },
      {
        memberId,
        tokenHash: base64url(),
        createdAt: sql`now() - interval '2 days'`,
        expiresAt: sql`now() - interval '1 day'`,
      },
    ]);

    expect(
      await revokeAccess(app.db, { actorId: adminId, partnershipId, memberId }),
    ).toEqual({ sessions: 0, passkeys: 0, invites: 0 });
  });

  it("audits what it ended", async () => {
    const { partnershipId, adminId, memberId } = await seed();
    const access = await seedAccess(memberId);
    await revokeAccess(app.db, { actorId: adminId, partnershipId, memberId });

    const audit = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, memberId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      action: "member_access.revoke",
      before: null,
    });
    const after = audit[0]!.after as Record<string, string[]>;
    expect(Object.keys(after).sort()).toEqual([
      "credentialIds",
      "inviteIds",
      "sessionIds",
    ]);
    expect([...after["sessionIds"]!].sort()).toEqual(
      [...access.sessionIds].sort(),
    );
    expect([...after["credentialIds"]!].sort()).toEqual(
      [...access.credentialIds].sort(),
    );
    expect(after["inviteIds"]).toEqual(access.inviteIds);
  });

  it("refuses an admin's own access, ending nothing", async () => {
    const { partnershipId, adminId } = await seed();
    const access = await seedAccess(adminId);

    expect(
      await revokeAccess(app.db, {
        actorId: adminId,
        partnershipId,
        memberId: adminId,
      }),
    ).toBe("own-access");
    expect(await stillLive(adminId)).toEqual({
      sessions: [...access.sessionIds].sort(),
      credentials: [...access.credentialIds].sort(),
      invites: access.inviteIds,
    });
  });

  it("returns null for a member of another partnership, ending nothing", async () => {
    const mine = await seed();
    const theirs = await seed();
    await seedAccess(theirs.memberId);

    expect(
      await revokeAccess(app.db, {
        actorId: mine.adminId,
        partnershipId: mine.partnershipId,
        memberId: theirs.memberId,
      }),
    ).toBeNull();
    const live = await stillLive(theirs.memberId);
    expect(live.sessions).toHaveLength(2);
    expect(live.credentials).toHaveLength(2);
    expect(live.invites).toHaveLength(1);
  });

  it("waits for a way in that holds the member, then ends what it opened", async () => {
    const { partnershipId, adminId, memberId } = await seed();
    let pending: ReturnType<typeof revokeAccess> | undefined;
    // A sign-in in progress: it holds the member, as every way in does,
    // and has opened a session not committed yet.
    await t.db.transaction(async (tx) => {
      await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.id, memberId))
        .for("share");
      await tx
        .insert(sessions)
        .values({ memberId, refreshTokenHash: base64url() });
      pending = revokeAccess(app.db, {
        actorId: adminId,
        partnershipId,
        memberId,
      });
      await waitForALockWait(t);
    });

    expect(await pending).toEqual({ sessions: 1, passkeys: 0, invites: 0 });
    expect((await stillLive(memberId)).sessions).toEqual([]);
  });
});
