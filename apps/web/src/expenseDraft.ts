// "Fiz um gasto" without React: what the partner typed in, the body the
// API wants out. The last word is the shared newExpense, the very schema
// the API checks, so the form never sends what the server would refuse.
import { newExpense, type NewExpense } from "@partneroj/contracts";

import { parseReaisToCents } from "./money";

/** The form as the partner left it: raw text, nothing checked yet. */
export interface ExpenseDraft {
  amount: string;
  categoryId: string | null;
  /** YYYY-MM-DD, as an <input type="date"> gives it. */
  occurredOn: string;
  description: string;
}

export type DraftProblem = "amount" | "category" | "date" | "description";

export type DraftResult =
  { ok: true; body: NewExpense } | { ok: false; problems: DraftProblem[] };

/** The body field each problem shows next to. */
const problemOf: Record<string, DraftProblem> = {
  amountCents: "amount",
  categoryId: "category",
  occurredOn: "date",
  description: "description",
};

const order: DraftProblem[] = ["amount", "category", "date", "description"];

/**
 * Checks the whole form at once and lists every problem, in the order the
 * fields appear, so the partner fixes them all in one go.
 */
export function readDraft(projectId: string, draft: ExpenseDraft): DraftResult {
  const description = draft.description.trim();
  const parsed = newExpense.safeParse({
    projectId,
    // "" fails the schema too, and shows as an amount problem.
    amountCents: parseReaisToCents(draft.amount) ?? "",
    categoryId: draft.categoryId ?? "",
    occurredOn: draft.occurredOn,
    ...(description === "" ? {} : { description }),
  });
  if (parsed.success) return { ok: true, body: parsed.data };

  const found = new Set<DraftProblem>();
  for (const issue of parsed.error.issues) {
    const problem = problemOf[String(issue.path[0])];
    // projectId comes from the API, never from the partner: a problem
    // there is a bug, not something to show on the form.
    if (problem === undefined)
      throw new Error("project id refused", { cause: issue });
    found.add(problem);
  }
  return { ok: false, problems: order.filter((p) => found.has(p)) };
}

/**
 * The phone's own day as YYYY-MM-DD. Not toISOString: that is the UTC
 * day, already tomorrow in Brazil after 21h.
 */
export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "2026-11-09" shown as "09/11/2026". */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}
