// Invites (plan section 6): a one-time link, valid for 24 hours. Opening
// the link only shows a preview; the invite is used by a tap (a POST),
// so the link preview of a messenger, which opens the link on its own,
// doesn't use it.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./jobs.js";
import { auditJson } from "./record-entry.js";
import {
  activities,
  auditLog,
  invites,
  members,
  partnerships,
  sessions,
} from "./schema.js";
import { hashToken, newToken } from "./tokens.js";

export const INVITE_LIFETIME_HOURS = 24;

/**
 * Creates an invite for a member and returns its token, which goes in the
 * link. The token is not stored, so it can't be shown again: a lost link
 * means a new invite. For a command on the server: createdBy is null and
 * any member can be invited.
 */
export async function createInvite(
  db: Database,
  input: { memberId: string; createdBy: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  return db.transaction((tx) =>
    insertInvite(tx, input.memberId, input.createdBy),
  );
}

/**
 * Creates an invite as an admin in the app, or returns null when the
 * member is not in the admin's partnership. The filter is in the query,
 * as in revokeSessions: no caller can invite into another partnership by
 * forgetting a check.
 */
export async function inviteMember(
  db: Database,
  input: { actorId: string; partnershipId: string; memberId: string },
): Promise<{ token: string; expiresAt: Date } | null> {
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
    return insertInvite(tx, member.id, input.actorId);
  });
}

/**
 * Revokes the member's invites still pending, so only the newest link
 * works (an old one may still sit in a chat), then inserts the new one.
 */
async function insertInvite(
  tx: Transaction,
  memberId: string,
  createdBy: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const replaced = await tx
    .update(invites)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(invites.memberId, memberId), usable()))
    .returning({ id: invites.id });

  const { token, tokenHash } = newToken();
  const [invite] = await tx
    .insert(invites)
    .values({
      memberId,
      tokenHash,
      expiresAt: sql`now() + make_interval(hours => ${INVITE_LIFETIME_HOURS})`,
      createdBy,
    })
    .returning();
  // The hash stays out of the audit, which people read: the fields are
  // listed one by one, so a new column doesn't slip in unnoticed.
  await tx.insert(auditLog).values({
    actorId: createdBy,
    action: "invite.create",
    entityId: invite!.id,
    after: auditJson({
      id: invite!.id,
      memberId: invite!.memberId,
      expiresAt: invite!.expiresAt,
      createdBy: invite!.createdBy,
      replacedInviteIds: replaced.map((r) => r.id),
    }),
  });
  return { token, expiresAt: invite!.expiresAt };
}

/** What the invite page shows: "Olá, Maria. Toque para entrar na Obra". */
export interface InvitePreview {
  memberName: string;
  partnershipName: string;
}

/** The preview of an invite that can still be used, or null. Uses nothing. */
export async function previewInvite(
  db: Database,
  token: string,
): Promise<InvitePreview | null> {
  const [row] = await db
    .select({
      memberName: members.name,
      partnershipName: partnerships.name,
    })
    .from(invites)
    .innerJoin(members, eq(members.id, invites.memberId))
    .innerJoin(partnerships, eq(partnerships.id, members.partnershipId))
    .where(and(eq(invites.tokenHash, hashToken(token)), usable()));
  return row ?? null;
}

/** The browser that tapped the button, from its User-Agent. */
export interface Device {
  device?: string | undefined;
  browser?: string | undefined;
}

/**
 * Uses the invite and opens a device session for its member, or returns
 * null when the invite can't be used. The session token goes in the
 * cookie; like the invite's, only its hash is stored.
 */
export async function acceptInvite(
  db: Database,
  token: string,
  device: Device = {},
): Promise<{ memberId: string; sessionToken: string } | null> {
  return db.transaction(async (tx) => {
    const invite = await consumeInvite(tx, hashToken(token));
    if (invite === null) return null;

    // The first session of a member is when they joined; a later invite,
    // after a lost phone, is not news for the feed.
    const [earlier] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.memberId, invite.memberId))
      .limit(1);

    const session = newToken();
    const [row] = await tx
      .insert(sessions)
      .values({
        memberId: invite.memberId,
        device: device.device,
        browser: device.browser,
        refreshTokenHash: session.tokenHash,
      })
      .returning({ id: sessions.id });

    if (earlier === undefined) {
      await tx.insert(activities).values({
        partnershipId: invite.partnershipId,
        actorId: invite.memberId,
        action: "member_joined",
      });
    }

    await tx.insert(auditLog).values({
      actorId: invite.memberId,
      action: "invite.accept",
      entityId: invite.id,
      after: { sessionId: row!.id, device: device.device ?? null },
    });

    return { memberId: invite.memberId, sessionToken: session.token };
  });
}

/**
 * Marks the invite as used and returns it, or null when it can't be used.
 * One UPDATE does the check and the change, so two taps at the same
 * moment can't both get through: the second waits for the first's row
 * lock, then finds the invite already used.
 */
async function consumeInvite(
  tx: Transaction,
  tokenHash: string,
): Promise<{ id: string; memberId: string; partnershipId: string } | null> {
  const [row] = await tx
    .update(invites)
    .set({ usedAt: sql`now()` })
    .from(members)
    .where(
      and(
        eq(invites.tokenHash, tokenHash),
        eq(members.id, invites.memberId),
        usable(),
      ),
    )
    .returning({
      id: invites.id,
      memberId: invites.memberId,
      partnershipId: members.partnershipId,
    });
  return row ?? null;
}

/** Not used, not revoked and not expired. */
function usable() {
  return and(
    isNull(invites.usedAt),
    isNull(invites.revokedAt),
    gt(invites.expiresAt, sql`now()`),
  );
}
