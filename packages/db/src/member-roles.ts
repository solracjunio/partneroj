// A member's role between partner and admin (plan section 2). Both vote,
// so an admin changes it alone; a reader's role changes who votes and
// takes a ballot (block 4).
//
// The admins' rows are the lock: changeRole holds every admin of the
// partnership FOR UPDATE, in id order, so two changes at once never
// deadlock. The actor is one of them, so any two changes in a
// partnership wait on each other; holding the member changed adds
// nothing. The lock only orders them; the
// check after it decides. It reads again in a new statement because the
// locking one, after its wait, rechecks only the rows it had found: an
// admin demoted meanwhile drops out, but one promoted meanwhile is not
// there. Counting from it would refuse a change that leaves 2 admins.
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { MIN_ADMINS } from "./partnerships.js";
import { auditLog, members } from "./schema.js";

export type RoleChange =
  | "changed"
  /** The member already had that role: nothing written, nothing audited. */
  | "unchanged"
  /** A reader becomes a partner or admin only by a ballot. */
  | "reader"
  /** The actor is not, or no longer, an admin of the partnership. */
  | "not-admin"
  /** Fewer than MIN_ADMINS would be left. */
  | "too-few-admins";

/**
 * Makes a partner an admin, or an admin a partner, with one audit row.
 * An admin may step down too, while MIN_ADMINS remain. Returns null when
 * the member is not in the actor's partnership.
 */
export async function changeRole(
  db: Database,
  input: {
    actorId: string;
    partnershipId: string;
    memberId: string;
    role: "admin" | "partner";
  },
): Promise<RoleChange | null> {
  return db.transaction(async (tx) => {
    const ofPartnership = eq(members.partnershipId, input.partnershipId);
    await tx
      .select({ id: members.id })
      .from(members)
      .where(and(ofPartnership, eq(members.role, "admin")))
      // No test tells this from no order: today both changes scan the
      // table the same way and meet the rows in the same order anyway. The
      // order keeps holding if the plan changes (an index, say).
      .orderBy(asc(members.id))
      .for("update");

    const admins = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(ofPartnership, eq(members.role, "admin")));
    if (!admins.some((a) => a.id === input.actorId)) return "not-admin";
    const [member] = await tx
      .select({ id: members.id, role: members.role })
      .from(members)
      .where(and(ofPartnership, eq(members.id, input.memberId)));
    if (member === undefined) return null;
    if (member.role === "reader") return "reader";
    if (member.role === input.role) return "unchanged";
    if (input.role === "partner" && admins.length - 1 < MIN_ADMINS) {
      return "too-few-admins";
    }

    await tx
      .update(members)
      .set({ role: input.role })
      .where(eq(members.id, member.id));
    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "member.role_change",
      entityId: member.id,
      before: { role: member.role },
      after: { role: input.role },
    });
    return "changed";
  });
}
