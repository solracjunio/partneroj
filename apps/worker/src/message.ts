// The words of a notification (plan section 4): the feed's own sentence
// (apps/web/src/feed.ts), so the phone and the "Atividades" screen say the
// same thing about the same entry.
import { formatCents, type PushMessage } from "@partneroj/contracts";
import type { EntryNotice } from "@partneroj/db";

export function emergencyMessage(activityId: string): PushMessage {
  return {
    title: "Um novo administrador foi criado pelo procedimento de emergência.",
    body: "Toque para ver em Atividades.",
    tag: activityId,
    url: "/atividades",
  };
}

/** "R$ 1.200,00", also for a reversal, whose amount is negative. */
function reais(cents: bigint): string {
  const positive = cents < 0n ? -cents : cents;
  return `R$ ${formatCents(positive.toString())}`;
}

/**
 * The notification for an entry. Example: "João fez um gasto de
 * R$ 1.200,00 em Material." with the description below. A tap opens the
 * entry; on an undo, the entry undone, which shows it as "Desfeito".
 */
export function entryMessage(notice: EntryNotice): PushMessage {
  const who = notice.authorName;
  const amount = reais(notice.amount);
  const where = notice.category === null ? "" : ` em ${notice.category}`;

  if (notice.reversalOf !== null) {
    return {
      title: `${who} desfez o gasto de ${amount}${where}.`,
      body: `Motivo: "${notice.reversalReason ?? ""}"`,
      tag: notice.entryId,
      url: `/lancamento/${notice.reversalOf}`,
    };
  }

  const what =
    notice.type === "expense"
      ? `fez um gasto de ${amount}${where}`
      : `registrou ${amount}${where}`;
  return {
    title: `${who} ${what}.`,
    body:
      notice.description === null
        ? "Toque para ver os detalhes."
        : `"${notice.description}"`,
    tag: notice.entryId,
    url: `/lancamento/${notice.entryId}`,
  };
}
