// The words of the "Lançamento" screen (plan section 5): one entry, who
// paid, who recorded it, its receipts and whether it was undone.
import {
  reverseEntryBody,
  type EntryDetails,
  type MemberName,
} from "@partneroj/contracts";

import type { Failure } from "./api";
import { formatDate } from "./expenseForm";
import { formatWhen } from "./feed";
import { formatCents } from "./money";

export interface EntryText {
  /** "Gasto de R$ 150,00 em Material", or "Desfaz um gasto de …". */
  title: string;
  /** The facts, as label and value, in the order they are shown. */
  rows: { label: string; value: string }[];
  /** "Confirmado" or "Desfeito", with who undid it, when and why. */
  status: { label: "Confirmado" | "Desfeito"; details: string[] };
}

/** "Você" for the signed-in member, the name for anyone else. */
function nameOf(member: MemberName, meId: string): string {
  return member.id === meId ? "Você" : member.name;
}

/**
 * The texts for an entry. `meId` is the signed-in member and `now` the
 * phone's clock, for "Hoje, 09:54". Example: "Gasto de R$ 150,00 em
 * Material", paid by João, recorded by Você.
 */
export function describeEntry(
  entry: EntryDetails,
  meId: string,
  now: Date,
): EntryText {
  const amount = `R$ ${formatCents(entry.amountCents.replace(/^-/, ""))}`;
  const where = entry.category === null ? "" : ` em ${entry.category}`;
  const what = entry.type === "expense" ? "gasto" : "lançamento";
  const title =
    entry.reversalOf === null
      ? `${what === "gasto" ? "Gasto" : "Lançamento"} de ${amount}${where}`
      : `Desfaz um ${what} de ${amount}${where}`;

  const rows = [
    {
      label: "Quem pagou",
      value:
        entry.paidBy === null
          ? "Conta da sociedade"
          : nameOf(entry.paidBy, meId),
    },
    {
      label: "Quem registrou",
      value: `${nameOf(entry.author, meId)}, ${formatWhen(entry.recordedAt, now)}`,
    },
    { label: "Dia do gasto", value: formatDate(entry.occurredOn) },
    ...(entry.description === null
      ? []
      : [{ label: "Descrição", value: `"${entry.description}"` }]),
  ];

  const status: EntryText["status"] =
    entry.reversal === null
      ? { label: "Confirmado", details: [] }
      : {
          label: "Desfeito",
          details: [
            `${nameOf(entry.reversal.by, meId)} desfez: ${formatWhen(
              entry.reversal.at,
              now,
            )}`,
            `Motivo: "${entry.reversal.reason}"`,
          ],
        };

  return { title, rows, status };
}

/** The most a reason can have: the server's own rule (contracts). */
export const REASON_MAX = 200;

/**
 * The reason typed in the "Desfazer" field, checked by the same contract
 * the server uses: trimmed, 1 to 200 letters.
 */
export function checkReason(
  typed: string,
): { ok: true; reason: string } | { ok: false; problem: string } {
  const parsed = reverseEntryBody.safeParse({ reason: typed });
  if (parsed.success) return { ok: true, reason: parsed.data.reason };
  return typed.trim() === ""
    ? { ok: false, problem: "Escreva por que está desfazendo este gasto." }
    : { ok: false, problem: `O motivo pode ter até ${REASON_MAX} letras.` };
}

const tryAgain = "Algo deu errado. Toque em Tentar de novo.";

/** Opening the screen failed. */
export const loadProblemText: Record<Failure, string> = {
  unusable: "Este lançamento não foi encontrado.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  offline: "Sem conexão. Confira a internet e toque em Tentar de novo.",
  conflict: tryAgain,
  refused: tryAgain,
  unsupported: tryAgain,
  error: tryAgain,
};

/** "Desfazer" failed: the entry was not undone, or was by someone else. */
export const reverseProblemText: Record<Failure, string> = {
  conflict: "Este gasto já tinha sido desfeito. Veja acima quem desfez.",
  refused: "O Partneroj não deixou desfazer este gasto.",
  unusable: "Este lançamento não foi encontrado.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  offline:
    "Sem conexão. Nada foi desfeito. Confira a internet e tente de novo.",
  unsupported: "Algo deu errado. Nada foi desfeito. Tente de novo.",
  error: "Algo deu errado. Nada foi desfeito. Tente de novo.",
};
