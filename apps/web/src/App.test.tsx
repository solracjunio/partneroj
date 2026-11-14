// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { navigate } from "./routes";
import { fakeServer, stubDisplayMode } from "./testing";

beforeEach(() => {
  stubDisplayMode({ standalone: true });
  fakeServer({
    "GET /api/me": {
      status: 200,
      body: {
        memberId: "01a1c25b-7bf8-7cea-b37d-5194960ba9c0",
        partnershipId: "01a1c25b-7bf8-7cea-b37d-5194960ba9c1",
        name: "Ana",
        role: "partner",
      },
    },
    "GET /api/activities/unread": { status: 200, body: { count: 0 } },
    "GET /api/activities": { status: 200, body: { items: [], next: null } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("opens the screen of the address and follows navigate()", async () => {
  window.history.replaceState(null, "", "/");
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Atividades" }));
  expect(
    await screen.findByRole("heading", { name: "Atividades" }),
  ).toBeTruthy();

  // The phone's "back" and navigate() both end in a popstate.
  navigate("/");
  expect(
    await screen.findByRole("heading", { name: "Olá, Ana." }),
  ).toBeTruthy();
});

it("says so for an address with no screen", () => {
  window.history.replaceState(null, "", "/nao-existe");
  render(<App />);
  expect(
    screen.getByRole("heading", { name: "Página não encontrada" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Voltar ao início" }).getAttribute("href"),
  ).toBe("/");
});
