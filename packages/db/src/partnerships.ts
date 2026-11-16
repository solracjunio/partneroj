// Creating a partnership (plan section 2): whoever creates it sets the
// first members. After that, partners come in only by a ballot.
import { asc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditLog, members, partnerships } from "./schema.js";

type Role = (typeof members.$inferSelect)["role"];

/** How a ballot on an entry is decided (ADR 0004). */
export type EntryBallotRule =
  (typeof partnerships.$inferSelect)["entryBallotRule"];

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
  input: {
    name: string;
    members: NewMember[];
    /** Majority when left out, as ADR 0004 says for a new partnership. */
    entryBallotRule?: EntryBallotRule;
    actorId: string | null;
  },
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
      .values({
        name: input.name.trim(),
        entryBallotRule: input.entryBallotRule,
      })
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
        after: {
          name: partnership!.name,
          entryBallotRule: partnership!.entryBallotRule,
        },
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

/**
 * Changes how the partnership's ballots on entries are decided, audited in
 * the same transaction. A ballot already open keeps the rule it opened
 * with (ballots.rule is frozen). Asking for the rule it already has
 * writes nothing.
 */
export async function setEntryBallotRule(
  db: Database,
  input: {
    partnershipId: string;
    rule: EntryBallotRule;
    actorId: string | null;
  },
): Promise<{ before: EntryBallotRule; after: EntryBallotRule }> {
  return db.transaction(async (tx) => {
    // FOR UPDATE: two changes at once are applied one after the other,
    // so each audit row's "before" is what the other left.
    const [current] = await tx
      .select({ rule: partnerships.entryBallotRule })
      .from(partnerships)
      .where(eq(partnerships.id, input.partnershipId))
      .for("update");
    if (current === undefined) {
      throw new Error(`no partnership ${input.partnershipId}`);
    }
    const before = current.rule;
    if (before === input.rule) return { before, after: before };

    await tx
      .update(partnerships)
      .set({ entryBallotRule: input.rule })
      .where(eq(partnerships.id, input.partnershipId));
    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "partnership.set_entry_ballot_rule",
      entityId: input.partnershipId,
      before: { entryBallotRule: before },
      after: { entryBallotRule: input.rule },
    });
    return { before, after: input.rule };
  });
}
