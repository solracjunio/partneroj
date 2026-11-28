import type { PgBoss } from "pg-boss";
import type { Database } from "./client.js";
import { insertInvite } from "./invites.js";
import { queueEmergencyNotification } from "./jobs.js";
import { activities, auditLog, members } from "./schema.js";

/** Server-only recovery: create a new identity, never reuse an old admin. */
export async function createEmergencyInvite(
  db: Database,
  boss: PgBoss,
  input: { partnershipId: string; name: string },
): Promise<{ memberId: string; token: string; expiresAt: Date }> {
  return db.transaction(async (tx) => {
    const [member] = await tx
      .insert(members)
      .values({ ...input, role: "admin" })
      .returning({ id: members.id });
    const memberId = member!.id;
    await tx.insert(auditLog).values({
      actorId: null,
      action: "member.emergency_create",
      entityId: memberId,
      after: { ...input, role: "admin" },
    });
    const invite = await insertInvite(tx, memberId, null);
    const [activity] = await tx
      .insert(activities)
      .values({
        partnershipId: input.partnershipId,
        action: "emergency_admin_created",
        targetMemberId: memberId,
      })
      .returning({ id: activities.id });
    await queueEmergencyNotification(boss, tx, activity!.id);
    return { memberId, ...invite };
  });
}
