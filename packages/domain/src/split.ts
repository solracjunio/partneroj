// Weighted split by largest remainder (docs/adr/0002).

export interface Weight {
  partnerId: string;
  /** Integer ≥ 1. The part is weight / sum of weights, with no rounding. */
  weight: number;
}

/**
 * Splits an amount in cents so that the parts always add up to it exactly.
 *
 * Each partner gets the floor of amount × weight / total, and the cents left
 * over (at most n − 1) go one each to the largest remainders. Weights must be
 * in the project's draw order, which breaks ties between equal remainders.
 * A negative amount is split as positive and the sign put back, so the first
 * in the draw also pays the extra cent of a loss.
 */
export function splitByWeights(
  amount: bigint,
  weights: readonly Weight[],
): Map<string, bigint> {
  if (amount < 0n) {
    const positive = splitByWeights(-amount, weights);
    return new Map([...positive].map(([id, part]) => [id, -part]));
  }
  assertValid(weights);

  const total = weights.reduce((sum, s) => sum + BigInt(s.weight), 0n);
  // amount × weight / total, kept as a numerator over the same total.
  const exact = weights.map((s) => amount * BigInt(s.weight));
  const parts = exact.map((e) => e / total);
  let leftover = amount - parts.reduce((sum, p) => sum + p, 0n);

  // Array.sort is stable, so equal remainders keep the draw order.
  const byRemainder = weights
    .map((_, i) => i)
    .sort((a, b) => Number((exact[b]! % total) - (exact[a]! % total)));
  for (const i of byRemainder) {
    if (leftover === 0n) break;
    parts[i]! += 1n;
    leftover--;
  }
  return new Map(weights.map((s, i) => [s.partnerId, parts[i]!]));
}

function assertValid(weights: readonly Weight[]): void {
  if (weights.length === 0) throw new RangeError("No weights to split among");
  const seen = new Set<string>();
  for (const { partnerId, weight } of weights) {
    if (!Number.isSafeInteger(weight) || weight < 1)
      throw new RangeError(`Weight of ${partnerId} must be an integer ≥ 1`);
    if (seen.has(partnerId))
      throw new RangeError(`Partner ${partnerId} is listed twice`);
    seen.add(partnerId);
  }
}
