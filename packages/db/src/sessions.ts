// Device sessions (plan section 6): long-lived, renewed on each use. A
// session that goes unused for SESSION_IDLE_DAYS ends on its own; one that
// is used keeps going, so in practice nobody has to enter again.
import { and, eq, gt, isNull, type SQL, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import { auditLog, members, sessions } from "./schema.js";
import { hashToken, newToken } from "./tokens.js";

export const SESSION_IDLE_DAYS = 180;

/**
 * A session that still lets its phone in: not revoked, and used within
 * SESSION_IDLE_DAYS. The same test for signing in and for sending a push,
 * so a phone that can no longer enter gets no notifications either.
 */
export function liveSession(): SQL {
  return and(
    isNull(sessions.revokedAt),
    gt(
      sessions.lastUsedAt,
      sql`now() - make_interval(days => ${SESSION_IDLE_DAYS})`,
    ),
  )!;
}

/**
 * Holds the member's row FOR SHARE until the caller's transaction ends.
 * Every way in (an invite, a passkey sign-in, a passkey registration)
 * calls it before checking anything, so it waits for a revokeAccess in
 * progress and then sees what it revoked (member-access.ts). FOR SHARE,
 * not FOR UPDATE, so ways in don't block each other: two phones of one
 * member signing in at once both go on. No test tells the two apart.
 */
export async function holdMember(
  tx: Transaction,
  memberId: string,
): Promise<void> {
  await tx
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, memberId))
    .for("share");
}

/** The browser that signs in, from its User-Agent. */
export interface Device {
  device?: string | undefined;
  browser?: string | undefined;
}

/**
 * A new session for a member, inside the caller's transaction: the way in
 * (an invite, for now) is used and the session opened together. The token
 * goes in the cookie; only its hash is stored.
 */
export async function openSession(
  tx: Transaction,
  memberId: string,
  device: Device,
): Promise<{ id: string; token: string }> {
  const { token, tokenHash } = newToken();
  const [row] = await tx
    .insert(sessions)
    .values({
      memberId,
      device: device.device,
      browser: device.browser,
      refreshTokenHash: tokenHash,
    })
    .returning({ id: sessions.id });
  return { id: row!.id, token };
}

/** Who is behind a request. */
export interface SessionMember {
  sessionId: string;
  memberId: string;
  partnershipId: string;
  name: string;
  role: (typeof members.$inferSelect)["role"];
}

/**
 * The member of a live session, or null. Marks the session as used now,
 * which is what keeps it alive: the check and the mark are one UPDATE, so
 * a session revoked at the same moment is not renewed.
 */
export async function findSession(
  db: Database,
  token: string,
): Promise<SessionMember | null> {
  const [row] = await db
    .update(sessions)
    .set({ lastUsedAt: sql`now()` })
    .from(members)
    .where(
      and(
        eq(sessions.refreshTokenHash, hashToken(token)),
        eq(members.id, sessions.memberId),
        liveSession(),
      ),
    )
    .returning({
      sessionId: sessions.id,
      memberId: members.id,
      partnershipId: members.partnershipId,
      name: members.name,
      role: members.role,
    });
  return row ?? null;
}

/**
 * Ends every live session of a member, as after a lost phone (plan
 * section 2). Returns how many were ended, or null when the member is not
 * in the actor's partnership: the filter is in the query, so no caller
 * can reach another partnership's members by forgetting a check.
 */
export async function revokeSessions(
  db: Database,
  input: { actorId: string; partnershipId: string; memberId: string },
): Promise<number | null> {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.id, input.memberId),
          eq(members.partnershipId, input.partnershipId),
        ),
      );
    if (member === undefined) return null;

    const ended = await tx
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.memberId, member.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "session.revoke",
      entityId: member.id,
      after: { sessionIds: ended.map((s) => s.id) },
    });
    return ended.length;
  });
}
