// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberAccess } from "./api";
import { MemberPage, MembersPage } from "./MembersPage";
import { type Answer, fakeServer, later } from "./testing";

const ids = {
  ana: "01a1c25b-7bf8-7cea-b37d-5194960ba9d0",
  bruno: "01a1c25b-7bf8-7cea-b37d-5194960ba9d1",
  caio: "01a1c25b-7bf8-7cea-b37d-5194960ba9d2",
};

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

const member = (more: Partial<MemberAccess>): MemberAccess => ({
  id: ids.ana,
  name: "Ana",
  role: "admin",
  sessions: 1,
  passkeys: 1,
  lastUsedAt: new Date().toISOString(),
  inviteExpiresAt: null,
  ...more,
});

const three = (): MemberAccess[] => [
  member({}),
  member({ id: ids.bruno, name: "Bruno", role: "partner", passkeys: 0 }),
  member({
    id: ids.caio,
    name: "Caio",
    role: "reader",
    sessions: 0,
    passkeys: 0,
    lastUsedAt: null,
  }),
];

const routes = {
  members: "GET /api/members",
  invite: (id: string) => `POST /api/members/${id}/invites`,
};

function membersServer(members: Answer = { status: 200, body: three() }) {
  return fakeServer({
    [routes.members]: members,
    [routes.invite(ids.caio)]: {
      status: 201,
      body: { token: "T".repeat(43), expiresAt: inAnHour() },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The card of a member, by the name on it. */
const card = (name: string) =>
  within(
    screen
      .getAllByRole("listitem")
      .find((li) => li.textContent?.startsWith(name))!,
  );

describe("Membros", () => {
  it("lists each member with their role and whether they get in", async () => {
    membersServer();
    render(<MembersPage />);
    await screen.findByRole("heading", { name: "Membros" });
    await screen.findAllByRole("listitem");

    expect(card("Ana").getByText("Administrador")).toBeTruthy();
    expect(
      card("Ana").getByText("Entra em 1 celular · digital salva"),
    ).toBeTruthy();
    expect(card("Bruno").getByText("Sócio")).toBeTruthy();
    expect(card("Bruno").getByText("Entra em 1 celular")).toBeTruthy();
    expect(card("Caio").getByText("Leitor")).toBeTruthy();
    expect(card("Caio").getByText("Sem acesso: gere um convite")).toBeTruthy();
    expect(
      card("Caio").getByRole("link", { name: "Caio ▸" }).getAttribute("href"),
    ).toBe(`/membros/${ids.caio}`);
  });

  it("tells a member who is not an admin that the screen is not theirs", async () => {
    membersServer({ status: 403 });
    render(<MembersPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Só administradores veem os membros.",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("tries again after no connection", async () => {
    const server = membersServer();
    server.next(routes.members, "offline");
    const user = userEvent.setup();
    render(<MembersPage />);
    await user.click(
      await screen.findByRole("button", { name: "Tentar de novo" }),
    );
    expect(await screen.findByText("Entra em 1 celular")).toBeTruthy();
  });

  it("says it is loading until the list comes", async () => {
    const answer = later<Answer>();
    membersServer(answer.promise as Answer);
    render(<MembersPage />);
    expect(await screen.findByText("Carregando…")).toBeTruthy();
    answer.settle({ status: 200, body: three() });
    expect(await screen.findByText("Entra em 1 celular")).toBeTruthy();
  });
});

describe("Membro", () => {
  it("shows the member's access and the way back", async () => {
    membersServer();
    render(<MemberPage id={ids.ana} />);
    await screen.findByRole("heading", { name: "Ana" });
    expect(screen.getByText("Entra em 1 celular · digital salva")).toBeTruthy();
    expect(screen.getByText(/^Usou o app: Hoje, /)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "← Voltar aos membros" })
        .getAttribute("href"),
    ).toBe("/membros");
  });

  it("shows a pending invite also when the member gets in", async () => {
    membersServer({
      status: 200,
      body: [member({ inviteExpiresAt: inAnHour() })],
    });
    render(<MemberPage id={ids.ana} />);
    expect(
      await screen.findByText(/^Convite enviado, vale até (hoje|amanhã), /),
    ).toBeTruthy();
  });

  it("makes an invite and shows its link once, to share or copy", async () => {
    const server = membersServer();
    const writeText = vi.fn(() => Promise.resolve());
    const share = vi.fn(() => Promise.resolve());
    // Before the stub: user-event puts its own clipboard on navigator.
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
      share,
    });
    render(<MemberPage id={ids.caio} />);
    await screen.findByText("Sem acesso: gere um convite");

    await user.click(screen.getByRole("button", { name: "Gerar convite" }));

    const link = `${window.location.origin}/convite/${"T".repeat(43)}`;
    expect(await screen.findByText(link)).toBeTruthy();
    expect(server.sent(routes.invite(ids.caio))).toHaveLength(1);
    expect(
      screen.getByText(
        "Vale por 24 horas e só funciona uma vez. Mande só para Caio.",
      ),
    ).toBeTruthy();
    // The line under the name shows the new invite.
    expect(
      screen.getByText(/^Convite enviado, vale até (hoje|amanhã), /),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gerar convite" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Compartilhar" }));
    expect(share).toHaveBeenCalledWith({
      title: "Convite do Partneroj",
      text: "Toque no link para entrar no Partneroj.",
      url: link,
    });
    await user.click(screen.getByRole("button", { name: "Copiar link" }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect((await screen.findByRole("status")).textContent).toBe(
      "Link copiado.",
    );
  });

  it("offers only to copy where the phone can't share", async () => {
    membersServer();
    // Before the stub: user-event puts its own clipboard on navigator.
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { ...navigator, share: undefined });
    render(<MemberPage id={ids.caio} />);
    await user.click(
      await screen.findByRole("button", { name: "Gerar convite" }),
    );
    expect(
      await screen.findByRole("button", { name: "Copiar link" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compartilhar" })).toBeNull();
  });

  it("keeps the link on the screen when copying fails", async () => {
    membersServer();
    // Before the stub: user-event puts its own clipboard on navigator.
    const user = userEvent.setup();
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    render(<MemberPage id={ids.caio} />);
    await user.click(
      await screen.findByRole("button", { name: "Gerar convite" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Copiar link" }),
    );
    expect(screen.getByText(/\/convite\/T+$/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says when the invite could not be made, and lets the admin try again", async () => {
    const server = membersServer();
    server.next(routes.invite(ids.caio), "offline");
    const user = userEvent.setup();
    render(<MemberPage id={ids.caio} />);
    await user.click(
      await screen.findByRole("button", { name: "Gerar convite" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão. Confira a internet e toque em Gerar convite de novo.",
    );
    await user.click(screen.getByRole("button", { name: "Gerar convite" }));
    expect(await screen.findByText(/\/convite\/T+$/)).toBeTruthy();
  });

  it("holds the button while the invite is on its way", async () => {
    const server = membersServer();
    const answer = later<Answer>();
    server.next(routes.invite(ids.caio), answer.promise as Answer);
    const user = userEvent.setup();
    render(<MemberPage id={ids.caio} />);
    await user.click(
      await screen.findByRole("button", { name: "Gerar convite" }),
    );
    const button = screen.getByRole("button", { name: "Gerando…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    answer.settle({
      status: 201,
      body: { token: "T".repeat(43), expiresAt: inAnHour() },
    });
    expect(await screen.findByText(/\/convite\/T+$/)).toBeTruthy();
  });

  it("says when the member is not in the partnership", async () => {
    membersServer();
    render(<MemberPage id="01a1c25b-7bf8-7cea-b37d-5194960ba9ff" />);
    expect(
      await screen.findByRole("heading", { name: "Membro não encontrado" }),
    ).toBeTruthy();
  });

  it("tells a member who is not an admin that the screen is not theirs", async () => {
    membersServer({ status: 403 });
    render(<MemberPage id={ids.ana} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Só administradores veem os membros.",
    );
  });
});
