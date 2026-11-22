// @vitest-environment jsdom
import type { PartnerBalance, ProjectBalances } from "@partneroj/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "./api";
import { BalancesPage } from "./BalancesPage";
import { type Answer, fakeServer } from "./testing";

const ids = {
  ana: "01a1c25b-7bf8-7cea-b37d-5194960ba9d0",
  bruno: "01a1c25b-7bf8-7cea-b37d-5194960ba9d1",
  caio: "01a1c25b-7bf8-7cea-b37d-5194960ba9d2",
  account: "01a1c25b-7bf8-7cea-b37d-5194960ba9d3",
};

const me: Me = {
  memberId: ids.ana,
  partnershipId: "01a1c25b-7bf8-7cea-b37d-5194960ba9d4",
  name: "Ana",
  role: "partner",
  hasPasskey: true,
};

const partner = (
  memberId: string,
  name: string,
  contributedCents: string,
  balanceCents: string,
  more: Partial<PartnerBalance> = {},
): PartnerBalance => ({
  memberId,
  name,
  weight: 1,
  contributedCents,
  withdrawnCents: "0",
  resultPartCents: "0",
  balanceCents,
  fairShareCents: "0",
  ...more,
});

const three = [
  partner(ids.ana, "Ana", "1240000", "50000"),
  partner(ids.bruno, "Bruno", "1190000", "0"),
  partner(ids.caio, "Caio", "1140000", "-50000"),
];

const ok = (body: Partial<ProjectBalances> = {}): Answer => ({
  status: 200,
  body: {
    project: { id: "01a1c25b-7bf8-7cea-b37d-5194960ba9d5", name: "Casa" },
    sameWeights: true,
    resultCents: "-3570000",
    partners: three,
    accounts: [],
    ...body,
  } satisfies ProjectBalances,
});

const routes = {
  me: "GET /api/me",
  balances: "GET /api/projects/current/balances",
};

function balancesServer(balances: Answer = ok()) {
  return fakeServer({
    [routes.me]: { status: 200, body: me },
    [routes.balances]: balances,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<BalancesPage />);
  await screen.findByRole("heading", { name: "Saldos · Casa" });
}

/** The card of a partner or account, by the name on it. */
const card = (name: RegExp) =>
  within(
    screen
      .getAllByRole("listitem")
      .find((li) => name.test(li.textContent ?? ""))!,
  );

describe("Saldos", () => {
  it("shows what each one put in and their balance, 'você' marked", async () => {
    balancesServer();
    await open();
    expect(card(/^Ana \(você\)/).getByText("R$ 12.400,00")).toBeTruthy();
    expect(card(/^Ana/).getByText("saldo + R$ 500,00")).toBeTruthy();
    expect(card(/^Bruno/).getByText("saldo R$ 0,00")).toBeTruthy();
    // Only the signed-in member is "você".
    expect(card(/^Bruno/).queryByText(/você/)).toBeNull();
    expect(card(/^Caio/).queryByText(/você/)).toBeNull();
    expect(card(/^Caio/).getByText("saldo − R$ 500,00")).toBeTruthy();
    expect(screen.getByText("Média de cada um: R$ 11.900,00")).toBeTruthy();
    expect(screen.queryByText(/parte pela cota/)).toBeNull();
  });

  it("explains the balance, and that they add up to zero", async () => {
    balancesServer();
    await open();
    expect(
      screen.getByRole("heading", { name: "O que é o saldo?" }),
    ).toBeTruthy();
    expect(screen.getByText("Somando todos, os saldos dão zero.")).toBeTruthy();
  });

  it("warns that the balances don't settle who owns the building", async () => {
    balancesServer();
    await open();
    expect(
      screen.getByText(
        "Os saldos mostram quanto cada um contribuiu. Eles não definem quem é dono do imóvel.",
      ),
    ).toBeTruthy();
  });

  it("shows each one's part by weight when the weights differ", async () => {
    balancesServer(
      ok({
        sameWeights: false,
        partners: [
          partner(ids.ana, "Ana", "1240000", "-260000", {
            weight: 2,
            fairShareCents: "1500000",
          }),
          partner(ids.bruno, "Bruno", "1010000", "260000", {
            fairShareCents: "750000",
          }),
        ],
      }),
    );
    await open();
    expect(
      card(/^Ana/).getByText("parte pela cota: R$ 15.000,00"),
    ).toBeTruthy();
    expect(screen.queryByText(/Média de cada um/)).toBeNull();
  });

  it("lists the company accounts, and drops the 'zero' sentence", async () => {
    balancesServer(
      ok({
        accounts: [
          { id: ids.account, name: "Conta da obra", balanceCents: "300000" },
        ],
      }),
    );
    await open();
    expect(
      screen.getByRole("heading", { name: "Contas da sociedade" }),
    ).toBeTruthy();
    expect(card(/^Conta da obra/).getByText("+ R$ 3.000,00")).toBeTruthy();
    // With an account, the balances add up to what is in the accounts.
    expect(screen.queryByText("Somando todos, os saldos dão zero.")).toBeNull();
  });
});

describe("opening it fails", () => {
  it("says there is no project yet, with nothing to retry", async () => {
    balancesServer({ status: 404 });
    render(<BalancesPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ainda não há um projeto aberto.",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("can be tried again without a connection", async () => {
    const server = balancesServer();
    server.next(routes.balances, "offline");
    const user = userEvent.setup();
    render(<BalancesPage />);
    await user.click(
      await screen.findByRole("button", { name: "Tentar de novo" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Saldos · Casa" }),
    ).toBeTruthy();
  });

  it("says so when the session is gone", async () => {
    const server = balancesServer();
    server.next(routes.me, { status: 401 });
    render(<BalancesPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Você saiu do Partneroj. Abra o app de novo para entrar.",
    );
  });
});
