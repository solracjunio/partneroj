// A member's access: the ways in (an invite, a passkey) and what they
// open (device sessions). Revoking ends all three at once, as after a
// lost phone (plan section 2).
//
// The member's row is the lock between them. revokeAccess holds it FOR
// UPDATE before ending anything; every way in holds it FOR SHARE
// (holdMember, in sessions.ts) before it checks anything. The lock only orders them; the check after it decides:
// in READ COMMITTED each statement after the wait sees what the other
// committed. So a way in that comes second finds its invite, passkey or
// session already revoked, and a revoke that comes second finds the
// session the way in opened. Without it no order of the UPDATEs works: a
// sign-in goes passkey → session, a passkey registration session →
// passkey.
import { and, asc, count, eq, isNull, max, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { usableInvite } from "./invites.js";
import { auditLog, credentials, invites, members, sessions } from "./schema.js";
import { liveSession } from "./sessions.js";

/** How many of each were still letting the member in. */
export interface RevokedAccess {
  sessions: number;
  passkeys: number;
  invites: number;
}

/**
 * Ends every live session, every passkey and every pending invite of a
 * member, with one audit row. Returns null when the member is not in the
 * actor's partnership (the filter is in the query, as in inviteMember),
 * and "own-access" for an admin revoking their own: another admin does
 * it (plan section 2). Coming back takes a new invite.
 */
export async function revokeAccess(
  db: Database,
  input: { actorId: string; partnershipId: string; memberId: string },
): Promise<RevokedAccess | "own-access" | null> {
  if (input.actorId === input.memberId) return "own-access";
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.id, input.memberId),
          eq(members.partnershipId, input.partnershipId),
        ),
      )
      .for("update");
    if (member === undefined) return null;

    // Idle sessions are ended too: they can't let anyone in, and a row
    // without revoked_at would read as live to whoever looks.
    const ended = await tx
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.memberId, member.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    const passkeys = await tx
      .update(credentials)
      .set({ revokedAt: sql`now()` })
      .where(
        and(eq(credentials.memberId, member.id), isNull(credentials.revokedAt)),
      )
      .returning({ id: credentials.id });
    // An expired invite already lets nobody in; it stays as it was.
    const pending = await tx
      .update(invites)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(invites.memberId, member.id), usableInvite()))
      .returning({ id: invites.id });

    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "member_access.revoke",
      entityId: member.id,
      after: {
        sessionIds: ended.map((s) => s.id),
        credentialIds: passkeys.map((c) => c.id),
        inviteIds: pending.map((i) => i.id),
      },
    });
    return {
      sessions: ended.length,
      passkeys: passkeys.length,
      invites: pending.length,
    };
  });
}

/** A member as the admin's "Membros" screen shows them. */
export interface MemberAccess {
  id: string;
  name: string;
  role: (typeof members.$inferSelect)["role"];
  /** Sessions that still let a phone in (liveSession). */
  sessions: number;
  /** Passkeys not revoked. */
  passkeys: number;
  /** The latest use among those sessions; null without any. */
  lastUsedAt: Date | null;
  /** When the pending invite stops working; null without one. */
  inviteExpiresAt: Date | null;
}

/**
 * The partnership's members, oldest first, with what lets each in. Only
 * reads: three grouped counts joined to the members, so the query costs
 * the same for any number of phones.
 */
export async function listMemberAccess(
  db: Database,
  partnershipId: string,
): Promise<MemberAccess[]> {
  const live = db
    .select({
      memberId: sessions.memberId,
      count: count().as("session_count"),
      lastUsedAt: max(sessions.lastUsedAt).as("last_used_at"),
    })
    .from(sessions)
    .where(liveSession())
    .groupBy(sessions.memberId)
    .as("live");
  const passkeys = db
    .select({
      memberId: credentials.memberId,
      count: count().as("passkey_count"),
    })
    .from(credentials)
    .where(isNull(credentials.revokedAt))
    .groupBy(credentials.memberId)
    .as("passkeys");
  // A new invite revokes the pending one (insertInvite), so there is at
  // most one; max() only makes the join one row per member.
  const pending = db
    .select({
      memberId: invites.memberId,
      expiresAt: max(invites.expiresAt).as("expires_at"),
    })
    .from(invites)
    .where(usableInvite())
    .groupBy(invites.memberId)
    .as("pending");

  return (
    db
      .select({
        id: members.id,
        name: members.name,
        role: members.role,
        sessions: sql<number>`coalesce(${live.count}, 0)`.mapWith(Number),
        passkeys: sql<number>`coalesce(${passkeys.count}, 0)`.mapWith(Number),
        lastUsedAt: live.lastUsedAt,
        inviteExpiresAt: pending.expiresAt,
      })
      .from(members)
      .leftJoin(live, eq(live.memberId, members.id))
      .leftJoin(passkeys, eq(passkeys.memberId, members.id))
      .leftJoin(pending, eq(pending.memberId, members.id))
      .where(eq(members.partnershipId, partnershipId))
      // As in activeCredentials. The id (uuidv7) breaks the tie between
      // members created together, who share the transaction's now(); no
      // test tells this from ordering by the id alone.
      .orderBy(asc(members.createdAt), asc(members.id))
  );
}
