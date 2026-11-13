import type { SessionMember } from "@partneroj/db";

/**
 * Who attaches a photo or PDF to an entry: only who recorded it, also
 * after it was undone (a receipt that arrives late still belongs to it).
 * A reader records nothing, so never. The upload route enforces it, and
 * the "Lançamento" screen shows the button from it, so the two never
 * disagree.
 */
export function mayAddReceipt(
  member: SessionMember,
  entry: { authorId: string },
): boolean {
  return member.role !== "reader" && entry.authorId === member.memberId;
}
