import type { EntryNotice } from "@partneroj/db";
import { describe, expect, it } from "vitest";

import { entryMessage } from "./message.js";

const entryId = "01a1c25b-7bf8-7cea-b37d-5194960ba97f";
const undoneId = "01a1c25b-6e0e-789c-be70-3b6100b2b90e";

const expense: EntryNotice = {
  entryId,
  type: "expense",
  amount: 120000n,
  category: "Material",
  description: "cimento e areia",
  authorName: "João",
  reversalOf: null,
  reversalReason: null,
  createdAt: new Date("2027-01-12T12:00:00Z"),
  subscriptionIds: [],
};

describe("entryMessage", () => {
  it("says who spent how much and where, as the feed does", () => {
    expect(entryMessage(expense)).toEqual({
      title: "João fez um gasto de R$ 1.200,00 em Material.",
      body: '"cimento e areia"',
      tag: entryId,
      url: `/lancamento/${entryId}`,
    });
  });

  it("points to the details when there is no description", () => {
    expect(entryMessage({ ...expense, description: null }).body).toBe(
      "Toque para ver os detalhes.",
    );
  });

  it("leaves the place out when there is no category", () => {
    expect(entryMessage({ ...expense, category: null }).title).toBe(
      "João fez um gasto de R$ 1.200,00.",
    );
  });

  it("says registrou for an entry that is not an expense", () => {
    expect(entryMessage({ ...expense, type: "contribution" }).title).toBe(
      "João registrou R$ 1.200,00 em Material.",
    );
  });

  it("tells about an undo with the reason, and opens the entry undone", () => {
    const reversal: EntryNotice = {
      ...expense,
      entryId,
      amount: -120000n,
      reversalOf: undoneId,
      reversalReason: "lancei duas vezes",
    };

    expect(entryMessage(reversal)).toEqual({
      title: "João desfez o gasto de R$ 1.200,00 em Material.",
      body: 'Motivo: "lancei duas vezes"',
      tag: entryId,
      url: `/lancamento/${undoneId}`,
    });
  });

  it("shows cents", () => {
    expect(entryMessage({ ...expense, amount: 1n }).title).toBe(
      "João fez um gasto de R$ 0,01 em Material.",
    );
  });
});
