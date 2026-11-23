// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberAccess, Me } from "./api";
import { MemberPage } from "./MembersPage";
import { type Answer, fakeServer, later } from "./testing";

const ids = {
  ana: "01a1c25b-7bf8-7cea-b37d-5194960ba9e0",
  bruno: "01a1c25b-7bf8-7cea-b37d-5194960ba9e1",
  caio: "01a1c25b-7bf8-7cea-b37d-5194960ba9e2",
};

const me: Me = {
  memberId: ids.ana,
  partnershipId: "01a1c25b-7bf8-7cea-b37d-5194960ba9ef",
  name: "Ana",
  role: "admin",
  hasPasskey: true,
};

const member = (more: Partial<MemberAccess>): MemberAccess => ({
  id: ids.bruno,
  name: "Bruno",
  role: "partner",
  sessions: 2,
  passkeys: 1,
  lastUsedAt: new Date().toISOString(),
  inviteExpiresAt: null,
  ...more,
});

const members: MemberAccess[] = [
  member({ id: ids.ana, name: "Ana", role: "admin" }),
  member({}),
  member({
    id: ids.caio,
    name: "Caio",
    sessions: 0,
    passkeys: 0,
    lastUsedAt: null,
  }),
];

const routes = {
  me: "GET /api/me",
  revoke: (id: string) => `POST /api/members/${id}/access/revoke`,
  invite: (id: string) => `POST /api/members/${id}/invites`,
};

function server(who: Answer = { status: 200, body: me }) {
  return fakeServer({
    [routes.me]: who,
    "GET /api/members": { status: 200, body: members },
    [routes.revoke(ids.bruno)]: {
      status: 200,
      body: { sessions: 2, passkeys: 1, invites: 0 },
    },
    [routes.invite(ids.bruno)]: {
      status: 201,
      body: {
        token: "T".repeat(43),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const revokeButton = () =>
  screen.findByRole("button", { name: "Revogar acesso" });

describe("Revogar acesso", () => {
  it("asks first, then ends the member's access and says so", async () => {
    const fake = server();
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);

    await user.click(await revokeButton());
    expect(
      screen.getByText(
        "Revogar o acesso de Bruno? Bruno sai de todos os celulares, e a digital e o convite deixam de valer. Para voltar, precisa de um convite novo.",
      ),
    ).toBeTruthy();
    expect(fake.sent(routes.revoke(ids.bruno))).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Sim, revogar" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Acesso revogado. Bruno saiu de todos os celulares, e a digital e o convite deixaram de valer. Para Bruno voltar, gere um convite novo.",
    );
    expect(fake.sent(routes.revoke(ids.bruno))).toHaveLength(1);
    expect(screen.getByText("Sem acesso: gere um convite")).toBeTruthy();
    expect(screen.queryByText(/^Usou o app/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Revogar acesso" })).toBeNull();
    expect(screen.getByRole("button", { name: "Gerar convite" })).toBeTruthy();
  });

  it("does nothing on Cancelar", async () => {
    const fake = server();
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);
    await user.click(await revokeButton());
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText(/^Revogar o acesso de/)).toBeNull();
    expect(screen.getByRole("button", { name: "Revogar acesso" })).toBeTruthy();
    expect(fake.sent(routes.revoke(ids.bruno))).toEqual([]);
  });

  it("takes away an invite link shown before, revoked with the rest", async () => {
    server();
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);
    await user.click(
      await screen.findByRole("button", { name: "Gerar convite" }),
    );
    await screen.findByText(/\/convite\/T+$/);

    await user.click(screen.getByRole("button", { name: "Revogar acesso" }));
    await user.click(screen.getByRole("button", { name: "Sim, revogar" }));
    await screen.findByRole("status");
    expect(screen.queryByText(/\/convite\/T+$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Gerar convite" })).toBeTruthy();
  });

  it("is not offered for one's own access", async () => {
    server();
    render(<MemberPage id={ids.ana} />);
    await screen.findByRole("heading", { name: "Ana" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Revogar acesso" })).toBeNull();
  });

  it("is not offered when nothing lets the member in", async () => {
    server();
    render(<MemberPage id={ids.caio} />);
    await screen.findByText("Sem acesso: gere um convite");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Revogar acesso" })).toBeNull();
  });

  it("is not offered when the screen doesn't know who is looking", async () => {
    server("offline");
    render(<MemberPage id={ids.bruno} />);
    await screen.findByRole("heading", { name: "Bruno" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "Revogar acesso" })).toBeNull();
  });

  it("says when it failed, and lets the admin try again", async () => {
    const fake = server();
    fake.next(routes.revoke(ids.bruno), "offline");
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);
    await user.click(await revokeButton());
    await user.click(screen.getByRole("button", { name: "Sim, revogar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão. Confira a internet e toque em Revogar de novo.",
    );
    // The member's line is the server's: nothing changed.
    expect(
      screen.getByText("Entra em 2 celulares · digital salva"),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Revogar acesso" }));
    await user.click(screen.getByRole("button", { name: "Sim, revogar" }));
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("tells an admin who tries their own access to ask another", async () => {
    const fake = server();
    fake.next(routes.revoke(ids.bruno), { status: 409 });
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);
    await user.click(await revokeButton());
    await user.click(screen.getByRole("button", { name: "Sim, revogar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Você não pode revogar o seu próprio acesso. Peça a outro administrador.",
    );
  });

  it("holds both buttons while the answer is on its way", async () => {
    const fake = server();
    const answer = later<Answer>();
    fake.next(routes.revoke(ids.bruno), answer.promise as Answer);
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);
    await user.click(await revokeButton());
    await user.click(screen.getByRole("button", { name: "Sim, revogar" }));

    const sending = screen.getByRole("button", { name: "Revogando…" });
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    answer.settle({
      status: 200,
      body: { sessions: 2, passkeys: 1, invites: 0 },
    });
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});
