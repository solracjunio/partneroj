import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvite,
  createInvite,
  inviteMember,
  previewInvite,
} from "./invites.js";
import {
  activities,
  auditLog,
  invites,
  members,
  partnerships,
  sessions,
} from "./schema.js";
import {
  connectAsApp,
  pgErrorCode,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";
import { hashToken, newToken } from "./tokens.js";

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

const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

/** A partnership with one member, "Maria". */
async function newMember(): Promise<{ id: string; partnershipId: string }> {
  const [p] = await t.db
    .insert(partnerships)
    .values({ name: "Obra Teste" })
    .returning();
  const [member] = await t.db
    .insert(members)
    .values({ partnershipId: p!.id, name: "Maria", role: "partner" })
    .returning();
  return { id: member!.id, partnershipId: p!.id };
}

/** An invite written directly, to reach states createInvite can't make. */
async function rawInvite(
  overrides: Partial<typeof invites.$inferInsert> = {},
): Promise<{ memberId: string; token: string }> {
  const member = await newMember();
  const { token, tokenHash } = newToken();
  await t.db.insert(invites).values({
    memberId: member.id,
    tokenHash,
    expiresAt: hours(24),
    ...overrides,
  });
  return { memberId: member.id, token };
}

describe("createInvite", () => {
  it("stores only the hash of the token", async () => {
    const member = await newMember();
    const { token } = await createInvite(app.db, {
      memberId: member.id,
      createdBy: null,
    });
    const [row] = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, member.id));
    expect(row!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("expires in 24 hours", async () => {
    const member = await newMember();
    const { expiresAt } = await createInvite(app.db, {
      memberId: member.id,
      createdBy: null,
    });
    const diff = expiresAt.getTime() - hours(24).getTime();
    expect(Math.abs(diff)).toBeLessThan(60_000);
  });

  it("writes an audit row without the hash", async () => {
    const member = await newMember();
    await createInvite(app.db, { memberId: member.id, createdBy: null });
    const [invite] = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, member.id));
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, invite!.id));
    expect(audit).toMatchObject({ actorId: null, action: "invite.create" });
    expect(JSON.stringify(audit!.after)).not.toContain(invite!.tokenHash);
  });
});

describe("a new invite", () => {
  it("revokes the member's pending invite: only the newest link works", async () => {
    const member = await newMember();
    const first = await createInvite(app.db, {
      memberId: member.id,
      createdBy: null,
    });
    const second = await createInvite(app.db, {
      memberId: member.id,
      createdBy: null,
    });
    expect(await previewInvite(app.db, first.token)).toBeNull();
    expect(await acceptInvite(app.db, first.token)).toBeNull();
    expect(await acceptInvite(app.db, second.token)).not.toBeNull();
  });

  it("records which invites it replaced", async () => {
    const member = await newMember();
    await createInvite(app.db, { memberId: member.id, createdBy: null });
    await createInvite(app.db, { memberId: member.id, createdBy: null });
    const rows = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, member.id))
      .orderBy(invites.id);
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, rows[1]!.id));
    expect(audit!.after).toMatchObject({ replacedInviteIds: [rows[0]!.id] });
  });
});

describe("inviteMember", () => {
  it("lets an admin invite a member of the same partnership", async () => {
    const member = await newMember();
    const [admin] = await t.db
      .insert(members)
      .values({
        partnershipId: member.partnershipId,
        name: "João",
        role: "admin",
      })
      .returning();
    const invite = await inviteMember(app.db, {
      actorId: admin!.id,
      partnershipId: member.partnershipId,
      memberId: member.id,
    });
    expect(await previewInvite(app.db, invite!.token)).toMatchObject({
      memberName: "Maria",
    });
    const [row] = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, member.id));
    expect(row!.createdBy).toBe(admin!.id);
  });

  it("returns null for a member of another partnership, inviting nobody", async () => {
    const ours = await newMember();
    const theirs = await newMember();
    const invite = await inviteMember(app.db, {
      actorId: ours.id,
      partnershipId: ours.partnershipId,
      memberId: theirs.id,
    });
    expect(invite).toBeNull();
    const rows = await t.db
      .select()
      .from(invites)
      .where(eq(invites.memberId, theirs.id));
    expect(rows).toEqual([]);
  });
});

describe("previewInvite", () => {
  it("shows the member and the partnership without using the invite", async () => {
    const { token } = await rawInvite();
    const preview = await previewInvite(app.db, token);
    expect(preview).toEqual({
      memberName: "Maria",
      partnershipName: "Obra Teste",
    });
    expect(await previewInvite(app.db, token)).toEqual(preview);
  });

  it("returns null for an invite already used", async () => {
    const { token } = await rawInvite({ usedAt: new Date() });
    expect(await previewInvite(app.db, token)).toBeNull();
  });
});

describe("acceptInvite", () => {
  it("opens a session for the member of a valid invite", async () => {
    const { memberId, token } = await rawInvite();
    const result = await acceptInvite(app.db, token, {
      device: "Android",
      browser: "Chrome",
    });
    expect(result?.memberId).toBe(memberId);

    const [session] = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.memberId, memberId));
    expect(session).toMatchObject({ device: "Android", browser: "Chrome" });
    expect(session!.refreshTokenHash).toBe(hashToken(result!.sessionToken));
  });

  it("returns null for an unknown token", async () => {
    expect(await acceptInvite(app.db, "nope")).toBeNull();
  });

  it("returns null the second time", async () => {
    const { token } = await rawInvite();
    await acceptInvite(app.db, token);
    expect(await acceptInvite(app.db, token)).toBeNull();
  });

  it("returns null for an expired invite", async () => {
    const { token } = await rawInvite({
      createdAt: hours(-48),
      expiresAt: hours(-24),
    });
    expect(await acceptInvite(app.db, token)).toBeNull();
  });

  it("returns null for a revoked invite", async () => {
    const { token } = await rawInvite({ revokedAt: new Date() });
    expect(await acceptInvite(app.db, token)).toBeNull();
  });

  it("lets only one of two simultaneous taps through", async () => {
    const { memberId, token } = await rawInvite();
    const results = await Promise.all([
      acceptInvite(app.db, token),
      acceptInvite(app.db, token),
    ]);
    const through = results.filter((r) => r !== null);
    expect(through.map((r) => r.memberId)).toEqual([memberId]);
    const rows = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.memberId, memberId));
    expect(rows).toHaveLength(1);
  });

  it("tells the feed only on the member's first session", async () => {
    const member = await newMember();
    for (let i = 0; i < 2; i++) {
      const { token } = await createInvite(app.db, {
        memberId: member.id,
        createdBy: null,
      });
      await acceptInvite(app.db, token);
    }
    const feed = await t.db
      .select()
      .from(activities)
      .where(eq(activities.actorId, member.id));
    expect(feed.map((a) => a.action)).toEqual(["member_joined"]);
  });

  it("audits the accept with the new session", async () => {
    const { memberId, token } = await rawInvite();
    await acceptInvite(app.db, token, { device: "Android" });
    const [session] = await t.db
      .select()
      .from(sessions)
      .where(eq(sessions.memberId, memberId));
    const [audit] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorId, memberId));
    expect(audit).toMatchObject({
      action: "invite.accept",
      after: { sessionId: session!.id, device: "Android" },
    });
  });
});

describe("invites and sessions", () => {
  it("refuses an invite that expires before it is created", async () => {
    expect(await pgErrorCode(rawInvite({ expiresAt: hours(-1) }))).toBe(
      "23514",
    );
  });

  it("refuses two sessions with the same refresh token", async () => {
    const member = await newMember();
    const { tokenHash } = newToken();
    const values = { memberId: member.id, refreshTokenHash: tokenHash };
    await t.db.insert(sessions).values(values);
    expect(await pgErrorCode(t.db.insert(sessions).values(values))).toBe(
      "23505",
    );
  });
});
