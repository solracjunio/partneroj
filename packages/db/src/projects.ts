// Projects, weights and categories (plan section 3, "Cotas como pesos").
// A project is where entries go (the house being built); each partner has
// a fixed weight in it (ADR 0002), and the draw order breaks ties when
// the split leaves cents over.
import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  auditLog,
  categories,
  members,
  partnerships,
  projects,
  weights,
} from "./schema.js";

type ProjectKind = (typeof projects.$inferSelect)["kind"];

export interface NewWeight {
  memberId: string;
  /** Integer ≥ 1, fixed for the whole project. */
  weight: number;
}

/**
 * The draw order of a project, drawn once at creation (ADR 0002): a
 * random permutation of 1..n, so nobody chooses who gets the extra cent.
 * Fisher-Yates with the crypto generator.
 */
export function drawOrder(count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * Creates a project with every member's weight, audited in one
 * transaction. Refuses a member of another partnership or a reader (a
 * reader only follows; plan section 2), and a weight that is not a whole
 * number ≥ 1. actorId is null for a command on the server.
 */
export async function createProject(
  db: Database,
  input: {
    partnershipId: string;
    name: string;
    kind: ProjectKind;
    startsOn: string;
    weights: NewWeight[];
    actorId: string | null;
  },
): Promise<{ id: string; weights: (NewWeight & { drawPosition: number })[] }> {
  if (input.weights.length === 0) throw new Error("a project needs weights");
  for (const w of input.weights) {
    if (!Number.isSafeInteger(w.weight) || w.weight < 1) {
      throw new Error("a weight must be a whole number of at least 1");
    }
  }
  const ids = input.weights.map((w) => w.memberId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("a member is listed twice");
  }

  return db.transaction(async (tx) => {
    // Members of this partnership who can hold a weight, in one query:
    // anyone missing is from another partnership, a reader or unknown.
    const found = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          inArray(members.id, ids),
          eq(members.partnershipId, input.partnershipId),
          ne(members.role, "reader"),
        ),
      );
    if (found.length !== ids.length) {
      throw new Error(
        "every weight must be of a partner or admin of this partnership",
      );
    }

    const [project] = await tx
      .insert(projects)
      .values({
        partnershipId: input.partnershipId,
        name: input.name.trim(),
        kind: input.kind,
        startsOn: input.startsOn,
      })
      .returning();
    const order = drawOrder(input.weights.length);
    const rows = input.weights.map((w, i) => ({
      projectId: project!.id,
      memberId: w.memberId,
      weight: w.weight,
      drawPosition: order[i]!,
    }));
    await tx.insert(weights).values(rows);

    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "project.create",
      entityId: project!.id,
      after: {
        name: project!.name,
        kind: project!.kind,
        startsOn: project!.startsOn,
        weights: rows.map(({ memberId, weight, drawPosition }) => ({
          memberId,
          weight,
          drawPosition,
        })),
      },
    });
    return {
      id: project!.id,
      weights: rows.map(({ memberId, weight, drawPosition }) => ({
        memberId,
        weight,
        drawPosition,
      })),
    };
  });
}

/**
 * Adds categories to a partnership (plan section 5: the buttons of "O que
 * foi"). A name it already has is skipped, so running it twice is safe.
 * Returns the names that were new.
 */
export async function addCategories(
  db: Database,
  input: { partnershipId: string; names: string[]; actorId: string | null },
): Promise<string[]> {
  const names = [...new Set(input.names.map((n) => n.trim()))];
  if (names.some((n) => n === "")) throw new Error("a category needs a name");

  return db.transaction(async (tx) => {
    const added = await tx
      .insert(categories)
      .values(
        names.map((name) => ({ partnershipId: input.partnershipId, name })),
      )
      .onConflictDoNothing({
        target: [categories.partnershipId, categories.name],
      })
      .returning();
    if (added.length > 0) {
      await tx.insert(auditLog).values(
        added.map((c) => ({
          actorId: input.actorId,
          action: "category.create",
          entityId: c.id,
          after: { partnershipId: c.partnershipId, name: c.name },
        })),
      );
    }
    return added.map((c) => c.name);
  });
}

export interface ProjectListing {
  id: string;
  name: string;
  kind: ProjectKind;
  startsOn: string;
  partnershipName: string;
}

/** Every project, by partnership: what the server command lists. */
export async function listProjects(db: Database): Promise<ProjectListing[]> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      startsOn: projects.startsOn,
      partnershipName: partnerships.name,
    })
    .from(projects)
    .innerJoin(partnerships, eq(partnerships.id, projects.partnershipId))
    .orderBy(asc(partnerships.createdAt), asc(projects.createdAt));
}
