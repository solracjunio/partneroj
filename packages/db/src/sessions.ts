// Device sessions (plan section 6): long-lived, renewed on each use. A
// session that goes unused for SESSION_IDLE_DAYS ends on its own; one that
// is used keeps going, so in practice nobody has to enter again.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { members, sessions } from "./schema.js";
import { hashToken } from "./tokens.js";

export const SESSION_IDLE_DAYS = 180;

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
        isNull(sessions.revokedAt),
        gt(
          sessions.lastUsedAt,
          sql`now() - make_interval(days => ${SESSION_IDLE_DAYS})`,
        ),
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
