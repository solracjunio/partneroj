// Accounts and categories (plan section 8), shared by the API and the web
// app: the partnership's own lists, shown as buttons. Only admins change
// them; one is archived, never deleted, since entries point at it.
import { z } from "zod";

/** The same bound as the database's checks (migration 0016). */
export const MAX_CHOICE_NAME_LENGTH = 60;

/**
 * A button's name: trimmed, from 1 to 60 characters, counted as the
 * database counts them ([...name] is by character; .length would count
 * an emoji as 2).
 */
export const choiceName = z
  .string()
  .trim()
  .refine((name) => {
    const length = [...name].length;
    return length >= 1 && length <= MAX_CHOICE_NAME_LENGTH;
  }, `1 to ${MAX_CHOICE_NAME_LENGTH} characters`)
  // For the API documentation, which can't read a refine: JSON Schema
  // counts minLength and maxLength by character too, so these are the
  // same bounds, not an approximation.
  .meta({ minLength: 1, maxLength: MAX_CHOICE_NAME_LENGTH });

/** A new account or category. */
export const newChoice = z.object({ name: choiceName });

export type NewChoice = z.infer<typeof newChoice>;

/**
 * One change per request, either a new name or archived/restored: each
 * is one audit row with one possible refusal. Strict, so a request with
 * both, or with a field this doesn't know, is refused instead of being
 * half applied.
 */
export const choiceChange = z.union([
  z.strictObject({ name: choiceName }),
  z.strictObject({ archived: z.boolean() }),
]);

export type ChoiceChange = z.infer<typeof choiceChange>;

/** `?archived=include` lists the archived ones too (the admin screen). */
export const choiceListQuery = z.object({
  archived: z.literal("include").optional(),
});

export type ChoiceListQuery = z.infer<typeof choiceListQuery>;

/** An account or category, as the API returns it. */
export interface Choice {
  id: string;
  name: string;
  /** ISO 8601; null while it is on the buttons. */
  archivedAt: string | null;
}
