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
