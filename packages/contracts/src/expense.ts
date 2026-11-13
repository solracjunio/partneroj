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

/**
 * "Desfazer" (ADR 0006): why the entry is undone. Required, and it goes
 * to the other partners with the notice.
 */
export const reverseEntryBody = z.object({
  reason: z.string().trim().min(1).max(200),
});

export type ReverseEntryBody = z.infer<typeof reverseEntryBody>;

/** The reversal, as the API returns it. */
export interface RecordedReversal {
  id: string;
  reversalOf: string;
  /** Negative: the original's amount with the sign inverted. */
  amountCents: string;
}

/** A member as the screens show them: who paid, who recorded, who undid. */
export interface MemberName {
  id: string;
  name: string;
}

/**
 * The "Lançamento" screen (plan section 5): one entry with its receipts
 * and its derived status (ADR 0006).
 */
export interface EntryDetails {
  id: string;
  type: string;
  /** Cents as a string; negative on a reversal. */
  amountCents: string;
  occurredOn: string;
  category: string | null;
  description: string | null;
  /** The pocket it came from; null when it came from an account. */
  paidBy: MemberName | null;
  author: MemberName;
  /** When it was recorded, as an ISO timestamp. */
  recordedAt: string;
  receipts: { id: string; contentType: string }[];
  status: "confirmed" | "reversed";
  /** On an entry that was undone: the reversal, who did it and why. */
  reversal: { id: string; reason: string; at: string; by: MemberName } | null;
  /** On a reversal: the entry it undoes. */
  reversalOf: string | null;
  /** Whether "Desfazer" is shown: decided by the server, not the screen. */
  canReverse: boolean;
  /** Whether "Adicionar comprovante" is shown: decided by the server too. */
  canAddReceipt: boolean;
}
