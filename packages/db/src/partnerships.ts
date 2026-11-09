// Creating a partnership (plan section 2): whoever creates it sets the
// first members. After that, partners come in only by a ballot.
import { asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditLog, members, partnerships } from "./schema.js";

type Role = (typeof members.$inferSelect)["role"];

export interface NewMember {
  name: string;
  role: Role;
}

export interface CreatedMember {
  id: string;
  name: string;
  role: Role;
}

/** Plan section 2: every partnership has at least 2 admins. */
export const MIN_ADMINS = 2;

/**
 * Creates a partnership and its first members, audited in the same
 * transaction. actorId is null for a command on the server, which is how
 * the first partnership is made: nobody has a session yet.
 */
export async function createPartnership(
  db: Database,
  input: { name: string; members: NewMember[]; actorId: string | null },
): Promise<{ id: string; members: CreatedMember[] }> {
  const admins = input.members.filter((m) => m.role === "admin").length;
  if (admins < MIN_ADMINS) {
    throw new Error(`a partnership needs at least ${MIN_ADMINS} admins`);
  }
  const names = input.members.map((m) => m.name.trim());
  if (names.some((n) => n === "")) throw new Error("a member needs a name");
  if (new Set(names).size !== names.length) {
    throw new Error("two members with the same name");
  }

  return db.transaction(async (tx) => {
    const [partnership] = await tx
      .insert(partnerships)
      .values({ name: input.name.trim() })
      .returning();
    const created = await tx
      .insert(members)
      .values(
        input.members.map((m) => ({
          partnershipId: partnership!.id,
          name: m.name.trim(),
          role: m.role,
        })),
      )
      .returning({ id: members.id, name: members.name, role: members.role });

    await tx.insert(auditLog).values([
      {
        actorId: input.actorId,
        action: "partnership.create",
        entityId: partnership!.id,
        after: { name: partnership!.name },
      },
      ...created.map((m) => ({
        actorId: input.actorId,
        action: "member.create",
        entityId: m.id,
        after: { partnershipId: partnership!.id, name: m.name, role: m.role },
      })),
    ]);
    return { id: partnership!.id, members: created };
  });
}

export interface MemberListing extends CreatedMember {
  partnershipId: string;
  partnershipName: string;
}

/** Every member, by partnership: what the server command lists. */
export async function listMembers(db: Database): Promise<MemberListing[]> {
  return db
    .select({
      id: members.id,
      name: members.name,
      role: members.role,
      partnershipId: partnerships.id,
      partnershipName: partnerships.name,
    })
    .from(members)
    .innerJoin(partnerships, eq(partnerships.id, members.partnershipId))
    .orderBy(asc(partnerships.createdAt), asc(members.createdAt));
}
