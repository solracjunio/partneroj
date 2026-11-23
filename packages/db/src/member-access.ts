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
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { usableInvite } from "./invites.js";
import { auditLog, credentials, invites, members, sessions } from "./schema.js";

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
