// The words of the "Atividades" screen: plain sentences, built from the
// API's feed items (plan section 5, "linguagem simples").
import type { FeedItem } from "@partneroj/contracts";

import { formatDate, localDate } from "./expenseForm";
import { formatCents } from "./money";

export interface FeedText {
  /** One sentence: who did what, how much and where. */
  headline: string;
  /** The description or the reason, and the day of the expense. */
  details: string[];
  /** Badges: "Novo" until read; "Desfeito" on an entry undone later. */
  badges: ("Novo" | "Desfeito")[];
}

/** "R$ 150,00", also for a reversal, whose amount comes negative. */
function reais(cents: string): string {
  return `R$ ${formatCents(cents.replace(/^-/, ""))}`;
}

/**
 * The sentence for an item. `meId` is the signed-in member: their own
 * activities say "Você". Example: "João fez um gasto de R$ 150,00 em
 * Material."
 */
export function describeItem(item: FeedItem, meId: string): FeedText {
  const me = item.actor.id === meId;
  const who = me ? "Você" : item.actor.name;
  const badges: FeedText["badges"] = item.unread ? ["Novo"] : [];
  const entry = item.entry;

  if (entry === null) {
    return {
      headline: `${who} entrou no Partneroj.`,
      details: [],
      badges,
    };
  }

  const where = entry.category === null ? "" : ` em ${entry.category}`;
  const day = `Gasto do dia ${formatDate(entry.occurredOn)}`;

  if (item.action === "entry_reversed") {
    return {
      headline: `${who} desfez o gasto de ${reais(entry.amountCents)}${where}.`,
      details: [`Motivo: "${entry.reversalReason ?? ""}"`, day],
      badges,
    };
  }

  if (entry.reversedBy !== null) badges.push("Desfeito");
  const what =
    entry.type === "expense"
      ? `fez um gasto de ${reais(entry.amountCents)}${where}`
      : `registrou ${reais(entry.amountCents)}${where}`;
  return {
    headline: `${who} ${what}.`,
    details: [
      ...(entry.description === null ? [] : [`"${entry.description}"`]),
      day,
    ],
    badges,
  };
}

/**
 * When it happened, in the phone's own time: "Hoje, 09:54", "Ontem,
 * 18:02" or "05/11/2026, 09:54".
 */
export function formatWhen(at: string, now: Date): string {
  const when = new Date(at);
  const time = `${String(when.getHours()).padStart(2, "0")}:${String(
    when.getMinutes(),
  ).padStart(2, "0")}`;
  const day = localDate(when);
  if (day === localDate(now)) return `Hoje, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === localDate(yesterday)) return `Ontem, ${time}`;
  return `${formatDate(day)}, ${time}`;
}

/** The link text of a receipt: a photo or a PDF. */
export function receiptLabel(contentType: string): string {
  return contentType === "application/pdf"
    ? "Ver comprovante (PDF)"
    : "Ver foto do comprovante";
}
