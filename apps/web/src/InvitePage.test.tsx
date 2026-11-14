// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvitePage } from "./InvitePage";
import { type Answer, fakeServer, later, stubDisplayMode } from "./testing";

// Made up: the same shape as a real token, used by no invite.
const token = "test-only-invite-token-0000000000000000000000";

const routes = {
  preview: `GET /api/invites/${token}`,
  accept: `POST /api/auth/invites/${token}/accept`,
};

function inviteServer(
  preview: Answer = {
    status: 200,
    body: { memberName: "Caio", partnershipName: "Obra Teste" },
  },
) {
  return fakeServer({
    [routes.preview]: preview,
    [routes.accept]: { status: 204 },
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", `/convite/${token}`);
  stubDisplayMode({ standalone: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens the link and waits for whom it is for. */
async function open() {
  const user = userEvent.setup();
  render(<InvitePage token={token} />);
  await screen.findByRole("heading", { name: "Olá, Caio." });
  return user;
}

const enter = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Entrar" }));

describe("the invite link", () => {
  it("only shows whom it is for: opening it uses nothing", async () => {
    const server = inviteServer();
    await open();
    expect(screen.getByText("Obra Teste")).toBeTruthy();
    // A messenger's link preview opens the address and never taps.
    expect(server.sent(routes.accept)).toEqual([]);
  });

  it("enters on the tap, and drops the used link from the history", async () => {
    const server = inviteServer();
    const user = await open();
    await enter(user);

    await screen.findByRole("heading", { name: "Pronto, Caio!" });
    expect(server.sent(routes.accept)).toHaveLength(1);
    expect(window.location.pathname).toBe("/");
    expect(
      screen.getByText("Instale o app e abra sempre pelo ícone."),
    ).toBeTruthy();
  });

  it("can't be tapped twice while entering", async () => {
    const server = inviteServer();
    const answer = later<Answer>();
    server.next(routes.accept, answer.promise as Answer);
    const user = await open();
    await enter(user);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Entrando…" })
        .disabled,
    ).toBe(true);
    answer.settle({ status: 204 });
    await screen.findByRole("heading", { name: "Pronto, Caio!" });
    expect(server.sent(routes.accept)).toHaveLength(1);
  });
});

describe("the tap fails", () => {
  it("says the invite no longer works when it was used meanwhile", async () => {
    const server = inviteServer();
    server.next(routes.accept, { status: 404 });
    const user = await open();
    await enter(user);
    expect(
      await screen.findByRole("heading", {
        name: "Este convite não vale mais",
      }),
    ).toBeTruthy();
  });

  it("can be tapped again after a lost connection", async () => {
    const server = inviteServer();
    server.next(routes.accept, "offline");
    const user = await open();
    await enter(user);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão. Confira a internet e toque de novo.",
    );
    await enter(user);
    await screen.findByRole("heading", { name: "Pronto, Caio!" });
  });

  it("asks to tap again later when the server fails", async () => {
    const server = inviteServer();
    server.next(routes.accept, { status: 500 });
    const user = await open();
    await enter(user);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Algo deu errado. Toque de novo daqui a pouco.",
    );
    expect(window.location.pathname).toBe(`/convite/${token}`);
  });
});

describe.each([
  [{ status: 404 }, "Este convite não vale mais"],
  ["offline" as const, "Sem conexão"],
  [{ status: 500 }, "Algo deu errado"],
])("opening a link answered %o", (answer, heading) => {
  it("says why, with no button to enter", async () => {
    inviteServer(answer);
    render(<InvitePage token={token} />);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Entrar" })).toBeNull();
  });
});
