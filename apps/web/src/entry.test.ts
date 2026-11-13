import type { EntryDetails } from "@partneroj/contracts";
import { describe, expect, it } from "vitest";

import { checkReason, describeEntry, REASON_MAX } from "./entry";

const joao = { id: "j", name: "João" };
const maria = { id: "m", name: "Maria" };
const now = new Date(2027, 0, 12, 15, 0);

function entry(overrides: Partial<EntryDetails> = {}): EntryDetails {
  return {
    id: "e1",
    type: "expense",
    amountCents: "15000",
    occurredOn: "2027-01-11",
    category: "Material",
    description: "cimento",
    paidBy: joao,
    author: joao,
    recordedAt: new Date(2027, 0, 12, 9, 54).toISOString(),
    receipts: [],
    status: "confirmed",
    reversal: null,
    reversalOf: null,
    canReverse: false,
    canAddReceipt: false,
    ...overrides,
  };
}

describe("describeEntry", () => {
  it("tells how much, where, who paid, who recorded, the day and description", () => {
    expect(describeEntry(entry(), "m", now)).toEqual({
      title: "Gasto de R$ 150,00 em Material",
      rows: [
        { label: "Quem pagou", value: "João" },
        { label: "Quem registrou", value: "João, Hoje, 09:54" },
        { label: "Dia do gasto", value: "11/01/2027" },
        { label: "Descrição", value: '"cimento"' },
      ],
      status: { label: "Confirmado", details: [] },
    });
  });

  it('says "Você" for the signed-in member', () => {
    const rows = describeEntry(entry(), "j", now).rows;
    expect(rows[0]).toEqual({ label: "Quem pagou", value: "Você" });
    expect(rows[1]).toEqual({
      label: "Quem registrou",
      value: "Você, Hoje, 09:54",
    });
  });

  it("leaves out what the entry doesn't have", () => {
    const text = describeEntry(
      entry({ category: null, description: null, paidBy: null }),
      "m",
      now,
    );
    expect(text.title).toBe("Gasto de R$ 150,00");
    expect(text.rows.map((row) => row.label)).toEqual([
      "Quem pagou",
      "Quem registrou",
      "Dia do gasto",
    ]);
    expect(text.rows[0]!.value).toBe("Conta da sociedade");
  });

  it("shows who undid it, when and why", () => {
    const text = describeEntry(
      entry({
        status: "reversed",
        reversal: {
          id: "r1",
          reason: "valor errado",
          at: new Date(2027, 0, 11, 18, 2).toISOString(),
          by: maria,
        },
      }),
      "j",
      now,
    );
    expect(text.status).toEqual({
      label: "Desfeito",
      details: ["Maria desfez: Ontem, 18:02", 'Motivo: "valor errado"'],
    });
  });

  it("names a reversal by what it undoes, without the minus sign", () => {
    const text = describeEntry(
      entry({ id: "r1", amountCents: "-15000", reversalOf: "e1" }),
      "m",
      now,
    );
    expect(text.title).toBe("Desfaz um gasto de R$ 150,00 em Material");
  });
});

describe("checkReason", () => {
  it("accepts a reason, trimmed", () => {
    expect(checkReason("  valor errado ")).toEqual({
      ok: true,
      reason: "valor errado",
    });
  });

  it("asks for a reason when there is none", () => {
    expect(checkReason("   ")).toEqual({
      ok: false,
      problem: "Escreva por que está desfazendo este gasto.",
    });
  });

  it("refuses a reason longer than the server takes", () => {
    expect(checkReason("a".repeat(REASON_MAX)).ok).toBe(true);
    expect(checkReason("a".repeat(REASON_MAX + 1))).toEqual({
      ok: false,
      problem: "O motivo pode ter até 200 letras.",
    });
  });
});
