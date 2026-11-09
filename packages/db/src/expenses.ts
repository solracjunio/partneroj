// A pocket expense (plan section 5, "Lancei um gasto"): the partner paid
// with their own money, so it counts as their contribution and the
// expense is split among everyone by weight.
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { Database } from "./client.js";
import { recordEntryIn, type Entry } from "./record-entry.js";
import { categories, projects, weights } from "./schema.js";

/** The project to record into, and the partnership's category buttons. */
export interface ProjectForEntries {
  project: { id: string; name: string };
  categories: { id: string; name: string }[];
}

/**
 * The partnership's newest project and its categories, or null when it
 * has no project yet. One project at a time is all the partners' version
 * needs; choosing among several comes with the full app (block 5 of the
 * plan's later phase).
 */
export async function currentProject(
  db: Database,
  partnershipId: string,
): Promise<ProjectForEntries | null> {
  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.partnershipId, partnershipId))
    .orderBy(desc(projects.createdAt))
    .limit(1);
  if (project === undefined) return null;
  const buttons = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.partnershipId, partnershipId))
    .orderBy(asc(categories.name));
  return { project, categories: buttons };
}

/** Why an expense was refused; the API turns each into a response. */
export type ExpenseRefusal =
  "project-not-found" | "category-not-found" | "payer-without-weight";

export class ExpenseRefused extends Error {
  constructor(readonly reason: ExpenseRefusal) {
    super(reason);
    this.name = "ExpenseRefused";
  }
}

export interface PocketExpense {
  projectId: string;
  /** Cents, positive (ADR 0005). */
  amount: bigint;
  categoryId: string;
  occurredOn: string;
  description?: string | undefined;
}

/**
 * Records an expense paid from the payer's pocket, with its feed row,
 * audit and push job (recordEntryIn). The payer comes from the session,
 * never from the request.
 *
 * The checks run in the same transaction as the insert, and each one is a
 * WHERE on the payer's partnership: a project or category of another
 * partnership is "not found", whatever the caller forgot to check.
 */
export async function recordExpense(
  db: Database,
  boss: PgBoss,
  payer: { memberId: string; partnershipId: string },
  expense: PocketExpense,
): Promise<Entry> {
  if (expense.amount <= 0n) throw new RangeError("amount must be positive");

  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, expense.projectId),
          eq(projects.partnershipId, payer.partnershipId),
        ),
      );
    if (project === undefined) throw new ExpenseRefused("project-not-found");

    const [category] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, expense.categoryId),
          eq(categories.partnershipId, payer.partnershipId),
        ),
      );
    if (category === undefined) throw new ExpenseRefused("category-not-found");

    // The payer's money becomes a contribution, and contributions are
    // counted per weight: a member without a weight in the project (a
    // reader, or someone added later) can't be the payer.
    const [weight] = await tx
      .select({ id: weights.id })
      .from(weights)
      .where(
        and(
          eq(weights.projectId, project.id),
          eq(weights.memberId, payer.memberId),
        ),
      );
    if (weight === undefined) throw new ExpenseRefused("payer-without-weight");

    const description = expense.description?.trim();
    return recordEntryIn(tx, boss, {
      projectId: project.id,
      type: "expense",
      amount: expense.amount,
      occurredOn: expense.occurredOn,
      // The partners' version records by cash date; accrual dates that
      // differ come with the other entry types.
      accrualOn: expense.occurredOn,
      fromMemberId: payer.memberId,
      categoryId: category.id,
      description: description === "" ? undefined : description,
      authorId: payer.memberId,
      source: "app",
    });
  });
}
