// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no WebAuthn; a phone with a fingerprint, for the passkey card
// and "Entrar com a digital", whose passkey the API accepts.
vi.mock(import("@simplewebauthn/browser"), async (original) => ({
  ...(await original()),
  platformAuthenticatorIsAvailable: () => Promise.resolve(true),
  browserSupportsWebAuthn: () => true,
  startAuthentication: () =>
    Promise.resolve({
      id: "Y3JlZGVudGlhbA",
      rawId: "Y3JlZGVudGlhbA",
      type: "public-key" as const,
      response: {
        clientDataJSON: "e30",
        authenticatorData: "YQ",
        signature: "YQ",
        userHandle: "YQ",
      },
      clientExtensionResults: {},
    }),
}));

import type { Me } from "./api";
import { HomePage } from "./HomePage";
import type { PartnerBalance, ProjectBalances } from "@partneroj/contracts";
import { type Answer, fakeServer, later, stubDisplayMode } from "./testing";

const me = (role: Me["role"]): Me => ({
  memberId: "01a1c25b-7bf8-7cea-b37d-5194960ba9a0",
  partnershipId: "01a1c25b-7bf8-7cea-b37d-5194960ba9a1",
  name: "Ana",
  role,
  hasPasskey: true,
});

function homeServer(
  who: Answer,
  unread: Answer = { status: 200, body: { count: 0 } },
  // No project yet, unless a test gives the balances.
  balances: Answer = { status: 404 },
) {
  return fakeServer({
    "GET /api/me": who,
    "GET /api/activities/unread": unread,
    "GET /api/projects/current/balances": balances,
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  stubDisplayMode({ standalone: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("greets a partner, who can record an expense", async () => {
  homeServer({ status: 200, body: me("partner") });
  const user = userEvent.setup();
  render(<HomePage />);
  await screen.findByRole("heading", { name: "Olá, Ana." });
  await user.click(screen.getByRole("button", { name: "Fiz um gasto" }));
  expect(window.location.pathname).toBe("/gasto");
});

it("asks a member without a passkey for one, above 'Fiz um gasto'", async () => {
  homeServer({ status: 200, body: { ...me("partner"), hasPasskey: false } });
  render(<HomePage />);
  const card = await screen.findByText("Proteja sua conta com a digital.");
  const record = screen.getByRole("button", { name: "Fiz um gasto" });
  expect(
    card.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("doesn't ask a member who has a passkey", async () => {
  homeServer({ status: 200, body: me("partner") });
  render(<HomePage />);
  await screen.findByRole("heading", { name: "Olá, Ana." });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText("Proteja sua conta com a digital.")).toBeNull();
});

it("gives a reader the feed but not 'Fiz um gasto'", async () => {
  homeServer({ status: 200, body: me("reader") });
  render(<HomePage />);
  await screen.findByRole("heading", { name: "Olá, Ana." });
  expect(screen.queryByRole("button", { name: "Fiz um gasto" })).toBeNull();
  expect(screen.getByRole("button", { name: "Atividades" })).toBeTruthy();
});

it("counts the new activities on the feed's button, which opens it", async () => {
  homeServer(
    { status: 200, body: me("admin") },
    { status: 200, body: { count: 2 } },
  );
  const user = userEvent.setup();
  render(<HomePage />);
  await user.click(
    await screen.findByRole("button", { name: "Atividades (2 novas)" }),
  );
  expect(window.location.pathname).toBe("/atividades");
});

it("keeps the plain button when the count fails", async () => {
  homeServer({ status: 200, body: me("partner") }, "offline");
  render(<HomePage />);
  await screen.findByRole("heading", { name: "Olá, Ana." });
  expect(screen.getByRole("button", { name: "Atividades" })).toBeTruthy();
});

it("explains how to get in when there is no session", async () => {
  homeServer({ status: 401 }, { status: 401 });
  render(<HomePage />);
  await screen.findByRole("heading", { name: "Partneroj" });
  expect(
    screen.getByText("Para entrar, peça um convite a um administrador."),
  ).toBeTruthy();
});

it("lets a member back in with the passkey, then loads the screen again", async () => {
  const api = fakeServer({
    // After signing in, the API knows this phone again.
    "GET /api/me": { status: 200, body: me("partner") },
    "GET /api/activities/unread": { status: 200, body: { count: 1 } },
    "GET /api/projects/current/balances": { status: 404 },
    "POST /api/auth/passkeys/login/options": {
      status: 200,
      body: { challenge: "YQ", rpId: "partneroj.test" },
    },
    "POST /api/auth/passkeys/login": { status: 204 },
  });
  // Signed out at first; then an answer the test holds, to see the wait.
  const reloaded = later<{ status: number; body?: unknown }>();
  api.next("GET /api/me", { status: 401 }, reloaded.promise);
  const user = userEvent.setup();
  render(<HomePage />);

  await user.click(
    await screen.findByRole("button", { name: "Entrar com a digital" }),
  );

  // Loading again, without the button to tap a second time.
  expect(await screen.findByText("Carregando…")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  reloaded.settle({ status: 200, body: me("partner") });
  expect(
    await screen.findByRole("heading", { name: "Olá, Ana." }),
  ).toBeTruthy();
  expect(api.sent("GET /api/me")).toHaveLength(2);
  expect(api.sent("GET /api/activities/unread")).toHaveLength(2);
});

it("says there is no connection", async () => {
  homeServer("offline", "offline");
  render(<HomePage />);
  expect(
    await screen.findByRole("heading", { name: "Sem conexão" }),
  ).toBeTruthy();
});

describe("Você já colocou", () => {
  const ana = me("partner");
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
  const other = "01a1c25b-7bf8-7cea-b37d-5194960ba9af";
  const balances = (
    partners: PartnerBalance[],
    sameWeights = true,
  ): Answer => ({
    status: 200,
    body: {
      project: { id: "01a1c25b-7bf8-7cea-b37d-5194960ba9ae", name: "Casa" },
      sameWeights,
      resultCents: "0",
      partners,
      accounts: [],
    } satisfies ProjectBalances,
  });

  async function openWith(answer: Answer, who: Me = ana) {
    homeServer({ status: 200, body: who }, undefined, answer);
    render(<HomePage />);
    await screen.findByRole("heading", { name: "Olá, Ana." });
  }

  it("shows what one put in, the average and the balance in words", async () => {
    await openWith(
      balances([
        partner(ana.memberId, "Ana", "1240000", "50000"),
        partner(other, "Bruno", "1140000", "-50000"),
      ]),
    );
    expect(await screen.findByText("R$ 12.400,00")).toBeTruthy();
    expect(screen.getByText("Média de cada um: R$ 11.900,00")).toBeTruthy();
    expect(screen.getByText("Seu saldo: + R$ 500,00")).toBeTruthy();
    expect(screen.getByText("Você colocou mais que a sua parte.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Ver os saldos de todos ▸" })
        .getAttribute("href"),
    ).toBe("/saldos");
  });

  it("says when one put in less than their part", async () => {
    await openWith(
      balances([
        partner(ana.memberId, "Ana", "1140000", "-50000"),
        partner(other, "Bruno", "1240000", "50000"),
      ]),
    );
    expect(await screen.findByText("Seu saldo: − R$ 500,00")).toBeTruthy();
    expect(
      screen.getByText("Você colocou menos que a sua parte."),
    ).toBeTruthy();
  });

  it("compares with one's part by weight when the weights differ", async () => {
    await openWith(
      balances(
        [
          partner(ana.memberId, "Ana", "1240000", "-260000", {
            weight: 2,
            fairShareCents: "1500000",
          }),
          partner(other, "Bruno", "1010000", "260000"),
        ],
        false,
      ),
    );
    expect(
      await screen.findByText("Sua parte pela cota: R$ 15.000,00"),
    ).toBeTruthy();
    expect(screen.queryByText(/Média de cada um/)).toBeNull();
  });

  it("says nobody put anything in yet, instead of zeros", async () => {
    await openWith(
      balances([
        partner(ana.memberId, "Ana", "0", "0"),
        partner(other, "Bruno", "0", "0"),
      ]),
    );
    expect(await screen.findByText("Ninguém colocou nada ainda.")).toBeTruthy();
    expect(screen.queryByText("Você já colocou")).toBeNull();
  });

  it("gives a reader only the way to the balances", async () => {
    await openWith(
      balances([partner(other, "Bruno", "1240000", "0")]),
      me("reader"),
    );
    expect(
      await screen.findByRole("link", { name: "Ver os saldos ▸" }),
    ).toBeTruthy();
    expect(screen.queryByText("Você já colocou")).toBeNull();
  });

  it("has no summary while there is no project", async () => {
    await openWith({ status: 404 });
    expect(screen.queryByText("Você já colocou")).toBeNull();
    expect(screen.queryByRole("link", { name: /Ver os saldos/ })).toBeNull();
  });
});
