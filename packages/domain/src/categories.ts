import type { LedgerEntry } from "./reversal.js";

const UNCATEGORIZED = "";

/**
 * Totals by entry type, then by category. A reversal keeps the type and
 * category of its original with the sign inverted, so it cancels inside the
 * same line instead of showing up as income.
 */
export function totalsByCategory(
  entries: readonly LedgerEntry[],
): Map<string, Map<string, bigint>> {
  const totals = new Map<string, Map<string, bigint>>();
  for (const { type, category = UNCATEGORIZED, amount } of entries) {
    const byCategory = totals.get(type) ?? new Map<string, bigint>();
    byCategory.set(category, (byCategory.get(category) ?? 0n) + amount);
    totals.set(type, byCategory);
  }
  return totals;
}
