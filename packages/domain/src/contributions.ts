// "Quanto cada um já colocou" (plan section 3): what each partner put in,
// next to the part of it that is theirs by weight.
import type { Balances } from "./balances.js";
import { splitByWeights, type Weight } from "./split.js";

/**
 * Each partner's fair part of everything the partners put in, split by
 * weight with the same largest remainder as the result, so the parts add
 * up to the total to the cent. With equal weights it is the average.
 * Weights in the project's draw order.
 */
export function fairShares(
  balances: Balances,
  weights: readonly Weight[],
): Map<string, bigint> {
  let total = 0n;
  for (const partner of balances.partners.values()) {
    total += partner.contributions;
  }
  return splitByWeights(total, weights);
}

/** Whether every partner weighs the same: the screen then says "média". */
export function sameWeights(weights: readonly Weight[]): boolean {
  // every() calls nothing on an empty list, so weights[0] is there.
  return weights.every((w) => w.weight === weights[0]!.weight);
}
