import type { FeedEntry, FeedItem } from "@partneroj/contracts";
import { describe, expect, it } from "vitest";

import {
  describeItem,
  feedButtonLabel,
  formatWhen,
  receiptLabel,
  unreadIds,
} from "./feed";

const joao = { id: "j", name: "João" };

const expense: FeedEntry = {
  id: "e1",
  type: "expense",
  amountCents: "15000",
  occurredOn: "2027-01-12",
  category: "Material",
  description: "cimento",
  reversalOf: null,
  reversalReason: null,
  reversedBy: null,
  receipts: [],
};

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "a1",
    action: "entry_recorded",
    at: "2027-01-12T12:00:00.000Z",
    actor: joao,
    unread: false,
    entry: expense,
    ...overrides,
  };
}

describe("describeItem", () => {
  it("tells who spent how much, where, with the description and day", () => {
    expect(describeItem(item(), "m")).toEqual({
      headline: "João fez um gasto de R$ 150,00 em Material.",
      details: ['"cimento"', "Gasto do dia 12/01/2027"],
      badges: [],
    });
  });

  it('says "Você" for the signed-in member', () => {
    expect(describeItem(item(), "j").headline).toBe(
      "Você fez um gasto de R$ 150,00 em Material.",
    );
  });

  it("leaves out a missing description", () => {
    const text = describeItem(
      item({ entry: { ...expense, description: null } }),
      "m",
    );
    expect(text.details).toEqual(["Gasto do dia 12/01/2027"]);
  });

  it("tells a reversal with a positive amount and its reason", () => {
    const text = describeItem(
      item({
        action: "entry_reversed",
        entry: {
          ...expense,
          id: "e2",
          amountCents: "-15000",
          reversalOf: "e1",
          reversalReason: "lancei duas vezes",
        },
      }),
      "m",
    );
    expect(text).toEqual({
      headline: "João desfez o gasto de R$ 150,00 em Material.",
      details: ['Motivo: "lancei duas vezes"', "Gasto do dia 12/01/2027"],
      badges: [],
    });
  });

  it('marks an undone expense "Desfeito" and an unread one "Novo"', () => {
    const text = describeItem(
      item({ unread: true, entry: { ...expense, reversedBy: "e2" } }),
      "m",
    );
    expect(text.badges).toEqual(["Novo", "Desfeito"]);
  });

  it("tells a member joining", () => {
    const text = describeItem(
      item({ action: "member_joined", entry: null, unread: true }),
      "m",
    );
    expect(text).toEqual({
      headline: "João entrou no Partneroj.",
      details: [],
      badges: ["Novo"],
    });
  });
});

describe("formatWhen", () => {
  // Built from local fields, so the test passes in any time zone.
  const now = new Date(2026, 10, 12, 10, 0);
  const at = (...fields: [number, number, number, number, number]) =>
    new Date(...fields).toISOString();

  it("says Hoje for today, in the phone's time", () => {
    expect(formatWhen(at(2026, 10, 12, 9, 5), now)).toBe("Hoje, 09:05");
  });

  it("says Ontem for yesterday, also across a month", () => {
    expect(formatWhen(at(2026, 10, 11, 18, 2), now)).toBe("Ontem, 18:02");
    const firstOfMonth = new Date(2026, 11, 1, 8, 0);
    expect(formatWhen(at(2026, 10, 30, 23, 59), firstOfMonth)).toBe(
      "Ontem, 23:59",
    );
  });

  it("gives the date for older days", () => {
    expect(formatWhen(at(2026, 10, 5, 9, 54), now)).toBe("05/11/2026, 09:54");
  });
});

describe("receiptLabel", () => {
  it("names a photo and a PDF apart", () => {
    expect(receiptLabel("image/jpeg")).toBe("Ver foto do comprovante");
    expect(receiptLabel("application/pdf")).toBe("Ver comprovante (PDF)");
  });
});

describe("unreadIds", () => {
  it("takes only the items still new", () => {
    const items = [
      item({ id: "a", unread: true }),
      item({ id: "b", unread: false }),
      item({ id: "c", unread: true }),
    ];
    expect(unreadIds(items)).toEqual(["a", "c"]);
  });
});

describe("feedButtonLabel", () => {
  it("shows how many are new, in the singular for one", () => {
    expect(feedButtonLabel(0)).toBe("Atividades");
    expect(feedButtonLabel(1)).toBe("Atividades (1 nova)");
    expect(feedButtonLabel(3)).toBe("Atividades (3 novas)");
  });
});
