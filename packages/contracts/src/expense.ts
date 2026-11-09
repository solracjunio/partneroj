// A pocket expense (plan section 5, "Novo gasto"), shared by the API and
// the web app: the form and the server refuse exactly the same values.
import { z } from "zod";

/**
 * Cents as a string of digits, never a JSON number: a bigint has no JSON
 * form, and a float would lose cents (ADR 0005). At most 12 digits, which
 * is below R$ 10 bilhões and far above any real expense.
 */
export const amountCents = z
  .string()
  .regex(/^[1-9]\d{0,11}$/, "a positive whole number of cents");

/**
 * What the partner sends. There is no "who paid": a pocket expense is
 * always paid by whoever is signed in, taken from the session, so nobody
 * can record an expense as paid by someone else.
 */
export const newExpense = z.object({
  projectId: z.uuid(),
  amountCents,
  categoryId: z.uuid(),
  /** When the money was spent, as YYYY-MM-DD. */
  occurredOn: z.iso.date(),
  description: z.string().trim().max(200).optional(),
});

export type NewExpense = z.infer<typeof newExpense>;

/** The recorded expense, as the API returns it. */
export interface RecordedExpense {
  id: string;
  amountCents: string;
  occurredOn: string;
}

/** The project to record into and its category buttons. */
export interface CurrentProject {
  project: { id: string; name: string };
  categories: { id: string; name: string }[];
}
