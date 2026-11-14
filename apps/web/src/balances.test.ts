import type { PartnerBalance, ProjectBalances } from "@partneroj/contracts";
import { describe, expect, it } from "vitest";

import {
  averageCents,
  balanceHint,
  comparisonFor,
  nothingPutIn,
  partnerOf,
  signedReais,
} from "./balances";

const partner = (
  memberId: string,
  contributedCents: string,
  more: Partial<PartnerBalance> = {},
): PartnerBalance => ({
  memberId,
  name: memberId.toUpperCase(),
  weight: 1,
  contributedCents,
  withdrawnCents: "0",
  resultPartCents: "0",
  balanceCents: "0",
  fairShareCents: "0",
  ...more,
});

const view = (
  partners: PartnerBalance[],
  sameWeights = true,
): ProjectBalances => ({
  project: { id: "p", name: "Casa" },
  sameWeights,
  resultCents: "0",
  partners,
  accounts: [],
});

describe("signedReais", () => {
  it("puts the sign in front, and none on zero", () => {
    expect(signedReais("50000")).toBe("+ R$ 500,00");
    expect(signedReais("-50000")).toBe("− R$ 500,00");
    expect(signedReais("0")).toBe("R$ 0,00");
    expect(signedReais("-1")).toBe("− R$ 0,01");
    expect(signedReais("123456789")).toBe("+ R$ 1.234.567,89");
  });
});

describe("balanceHint", () => {
  it("says in plain words what the balance means", () => {
    expect(balanceHint("1")).toBe("Você colocou mais que a sua parte.");
    expect(balanceHint("-1")).toBe("Você colocou menos que a sua parte.");
    expect(balanceHint("0")).toBe("Você está em dia.");
  });
});

describe("averageCents", () => {
  it("is what was put in divided by the partners, in whole cents", () => {
    expect(averageCents(view([partner("a", "100"), partner("b", "201")]))).toBe(
      "150",
    );
  });

  it("is zero before anything was put in", () => {
    expect(averageCents(view([partner("a", "0"), partner("b", "0")]))).toBe(
      "0",
    );
  });
});

describe("comparisonFor", () => {
  it("is the average when the weights are equal", () => {
    const a = partner("a", "30000", { fairShareCents: "15001" });
    const b = partner("b", "0", { fairShareCents: "14999" });
    expect(comparisonFor(view([a, b]), a)).toEqual({
      label: "Média de cada um",
      cents: "15000",
    });
  });

  it("is the partner's own part when the weights differ", () => {
    const a = partner("a", "30000", { weight: 2, fairShareCents: "20000" });
    const b = partner("b", "0", { fairShareCents: "10000" });
    expect(comparisonFor(view([a, b], false), a)).toEqual({
      label: "Sua parte pela cota",
      cents: "20000",
    });
  });
});

describe("partnerOf", () => {
  it("finds the signed-in member, or nothing for a reader", () => {
    const balances = view([partner("a", "1"), partner("b", "2")]);
    expect(partnerOf(balances, "b")?.contributedCents).toBe("2");
    expect(partnerOf(balances, "reader")).toBeUndefined();
  });
});

describe("nothingPutIn", () => {
  it("is true only while nobody put anything in", () => {
    expect(nothingPutIn(view([partner("a", "0"), partner("b", "0")]))).toBe(
      true,
    );
    expect(nothingPutIn(view([partner("a", "0"), partner("b", "1")]))).toBe(
      false,
    );
  });
});
