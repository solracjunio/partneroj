// Using an invite (plan section 6): one tap, one session, never two.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { invites } from "./schema.js";

/**
 * Marks the invite as used and returns its member, or null when the
 * invite can't be used. One UPDATE does the check and the change, so two
 * taps at the same moment can't both get through: the second waits for
 * the first's row lock, then finds the invite already used.
 */
export async function consumeInvite(
  db: Database,
  tokenHash: string,
): Promise<{ memberId: string } | null> {
  const [row] = await db
    .update(invites)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(invites.tokenHash, tokenHash),
        isNull(invites.usedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    )
    .returning({ memberId: invites.memberId });
  return row ?? null;
}
