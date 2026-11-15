// Final settlement with the money left in the accounts (plan section 3,
// "Acerto final"): who pays whom so that every balance ends at zero.
import type { Balances, Party } from "./balances.js";

/**
 * One side of the settlement. A partner's balance is theirs: positive when
 * they put in more than their share and should get money back. An account
 * enters owing what it holds, so the money left in it goes back to the
 * partners; by the golden rule, all balances then add up to zero.
 */
export interface Participant {
  party: Party;
  balance: bigint;
}

/**
 * One payment of the settlement, always to a partner. From an account it
 * is a suggested withdrawal; from another partner, a Pix.
 */
export interface Transfer {
  from: Party;
  to: { partner: string };
  amount: bigint;
  kind: "withdrawal" | "pix";
}

/** The partners, in the weights' order, then each account owing what it holds. */
export function settlementParticipants(balances: Balances): Participant[] {
  return [
    ...[...balances.partners].map(([id, b]) => ({
      party: { partner: id },
      balance: b.balance,
    })),
    ...[...balances.accounts].map(([id, held]) => ({
      party: { account: id },
      balance: -held,
    })),
  ];
}

/**
 * Greedy simplification: the largest debtor pays the largest creditor as
 * much as one of them needs, until everyone is even. Each payment settles
 * at least one of the two, and the last settles both, so n participants
 * who aren't even need at most n − 1 transfers. Not always the fewest:
 * see the exact search.
 *
 * Ties go to whoever comes first in the list, so the same balances always
 * give the same transfers.
 */
export function greedyTransfers(
  participants: readonly Participant[],
): Transfer[] {
  assertSettleable(participants);
  const left = participants.map((p) => ({ ...p }));
  const transfers: Transfer[] = [];

  for (;;) {
    const creditor = extreme(left, (a, b) => a > b);
    const debtor = extreme(left, (a, b) => a < b);
    if (creditor === undefined || creditor.balance === 0n) return transfers;
    // The sum is zero, so a creditor left means a debtor left too.
    const amount =
      // Stryker disable next-line EqualityOperator: when equal, both branches give the same amount.
      creditor.balance < -debtor!.balance ? creditor.balance : -debtor!.balance;
    creditor.balance -= amount;
    debtor!.balance += amount;
    transfers.push(transfer(debtor!.party, creditor.party, amount));
  }
}

/**
 * Up to this many participants who aren't even, settle searches for the
 * fewest transfers; above it, the greedy alone (ADR 0009).
 */
export const EXACT_SEARCH_LIMIT = 8;

/**
 * The settlement's transfers, the fewest possible (ADR 0009). The fewest
 * is the people who aren't even minus the most groups they split into
 * where each group adds up to zero: no transfer needs to cross groups, and
 * a group of k needs k − 1, which the greedy makes inside it. Finding the
 * groups is exponential, so above EXACT_SEARCH_LIMIT the greedy alone
 * answers, still with at most n − 1.
 */
export function settle(participants: readonly Participant[]): Transfer[] {
  assertSettleable(participants);
  const uneven = participants.filter((p) => p.balance !== 0n);
  if (uneven.length > EXACT_SEARCH_LIMIT) return greedyTransfers(uneven);
  return zeroSumGroups(uneven).flatMap((group) => greedyTransfers(group));
}

/**
 * The most groups adding up to zero that the list splits into, each in the
 * list's order. Sets of people are bitmasks (bit i is list[i]). Each split
 * tries only the groups holding the first person left, so no split is
 * counted twice. Nothing is remembered between branches: with up to 8
 * people the worst case measured is 1,245 steps (ADR 0009).
 */
function zeroSumGroups(list: readonly Participant[]): Participant[][] {
  const sums = maskSums(list);

  const split = (left: number): number[] => {
    // Stryker disable next-line all: with nobody left the loop alone also gives [], and anything else here becomes an empty group, with no transfer.
    if (left === 0) return [];
    const first = left & -left;
    // `left` adds up to zero, so the loop finds at least `left` itself.
    let most: number[] = [];
    for (let group = left; group > 0; group = (group - 1) & left) {
      if ((group & first) === 0 || sums[group] !== 0n) continue;
      const rest = split(left ^ group);
      // Stryker disable next-line EqualityOperator: on a tie both splits have as few transfers, and either is deterministic.
      if (rest.length + 1 > most.length) most = [group, ...rest];
    }
    return most;
  };

  return split((1 << list.length) - 1).map((group) =>
    list.filter((_, i) => (group & (1 << i)) !== 0),
  );
}

/** Each set's balance: a set's sum is its lowest member plus the rest's. */
function maskSums(list: readonly Participant[]): bigint[] {
  const sums = [0n];
  for (let mask = 1; mask < 1 << list.length; mask++) {
    const lowest = 31 - Math.clz32(mask & -mask);
    // Stryker disable next-line ArithmeticOperator: subtracting gives −sum, which is zero exactly when sum is, and only zero is asked.
    sums[mask] = sums[mask & (mask - 1)]! + list[lowest]!.balance;
  }
  return sums;
}

/** The first participant whose balance beats all the others by `beats`. */
function extreme(
  list: Participant[],
  beats: (a: bigint, b: bigint) => boolean,
): Participant | undefined {
  let best: Participant | undefined;
  for (const p of list) {
    if (best === undefined || beats(p.balance, best.balance)) best = p;
  }
  return best;
}

function transfer(from: Party, to: Party, amount: bigint): Transfer {
  // assertSettleable made sure only partners are creditors.
  const partner = (to as { partner: string }).partner;
  return {
    from,
    to: { partner },
    amount,
    kind: "partner" in from ? "pix" : "withdrawal",
  };
}

function assertSettleable(participants: readonly Participant[]): void {
  const sum = participants.reduce((s, p) => s + p.balance, 0n);
  // The golden rule broke somewhere upstream; settling would hide it.
  if (sum !== 0n) throw new RangeError(`Balances add up to ${sum}, not zero`);
  for (const { party, balance } of participants) {
    if ("account" in party && balance > 0n) {
      throw new RangeError(`Account ${party.account} can't receive money`);
    }
  }
}
