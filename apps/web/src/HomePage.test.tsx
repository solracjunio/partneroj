// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Me } from "./api";
import { HomePage } from "./HomePage";
import { type Answer, fakeServer, stubDisplayMode } from "./testing";

const me = (role: Me["role"]): Me => ({
  memberId: "01a1c25b-7bf8-7cea-b37d-5194960ba9a0",
  partnershipId: "01a1c25b-7bf8-7cea-b37d-5194960ba9a1",
  name: "Ana",
  role,
});

function homeServer(
  who: Answer,
  unread: Answer = { status: 200, body: { count: 0 } },
) {
  return fakeServer({
    "GET /api/me": who,
    "GET /api/activities/unread": unread,
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

it("says there is no connection", async () => {
  homeServer("offline", "offline");
  render(<HomePage />);
  expect(
    await screen.findByRole("heading", { name: "Sem conexão" }),
  ).toBeTruthy();
});
