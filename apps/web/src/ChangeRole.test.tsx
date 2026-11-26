// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemberAccess, Me } from "./api";
import { MemberPage } from "./MembersPage";
import { type Answer, fakeServer, later } from "./testing";

const ids = {
  ana: "01a1c25b-7bf8-7cea-b37d-5194960ba9e0",
  maria: "01a1c25b-7bf8-7cea-b37d-5194960ba9e1",
  joao: "01a1c25b-7bf8-7cea-b37d-5194960ba9e2",
  bruno: "01a1c25b-7bf8-7cea-b37d-5194960ba9e3",
  caio: "01a1c25b-7bf8-7cea-b37d-5194960ba9e4",
};

/** Ana is looking, an admin. */
const me: Me = {
  memberId: ids.ana,
  partnershipId: "01a1c25b-7bf8-7cea-b37d-5194960ba9ef",
  name: "Ana",
  role: "admin",
  hasPasskey: true,
};

const member = (
  id: string,
  name: string,
  role: MemberAccess["role"],
): MemberAccess => ({
  id,
  name,
  role,
  sessions: 1,
  passkeys: 1,
  lastUsedAt: new Date().toISOString(),
  inviteExpiresAt: null,
});

/** Ana and Maria admins, Bruno a partner, Caio a reader; João a third admin. */
function partnership({ joao = false } = {}): MemberAccess[] {
  return [
    member(ids.ana, "Ana", "admin"),
    member(ids.maria, "Maria", "admin"),
    ...(joao ? [member(ids.joao, "João", "admin")] : []),
    member(ids.bruno, "Bruno", "partner"),
    member(ids.caio, "Caio", "reader"),
  ];
}

const roleRoute = (id: string) => `POST /api/members/${id}/role`;

function server({
  who = { status: 200, body: me },
  joao = false,
}: { who?: Answer; joao?: boolean } = {}) {
  return fakeServer({
    "GET /api/me": who,
    "GET /api/members": { status: 200, body: partnership({ joao }) },
    [roleRoute(ids.bruno)]: { status: 204 },
    [roleRoute(ids.maria)]: { status: 204 },
    [roleRoute(ids.ana)]: { status: 204 },
  });
}

/** The roles the screen sent to a member's route. */
const sentRoles = (fake: ReturnType<typeof server>, id: string) =>
  fake
    .sent(roleRoute(id))
    .map((r) => (JSON.parse(r.body as string) as { role: string }).role);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Tornar administrador", () => {
  it("asks first, then makes the partner an admin and says so", async () => {
    const fake = server();
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);

    await user.click(
      await screen.findByRole("button", { name: "Tornar administrador" }),
    );
    expect(
      screen.getByText(
        "Tornar Bruno administrador? Bruno vai poder gerar convites, cuidar de contas e categorias e fechar períodos.",
      ),
    ).toBeTruthy();
    expect(sentRoles(fake, ids.bruno)).toEqual([]);

    await user.click(
      screen.getByRole("button", { name: "Sim, tornar administrador" }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "O papel de Bruno agora é Administrador.",
    );
    expect(sentRoles(fake, ids.bruno)).toEqual(["admin"]);
    expect(screen.getByText("Administrador")).toBeTruthy();
    // With Bruno, 3 admins: he can be taken out again.
    expect(
      screen.getByRole("button", { name: "Tirar de administrador" }),
    ).toBeTruthy();
  });

  it("does nothing on Cancelar", async () => {
    const fake = server();
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);
    await user.click(
      await screen.findByRole("button", { name: "Tornar administrador" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByText(/^Tornar Bruno administrador\?/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Tornar administrador" }),
    ).toBeTruthy();
    expect(sentRoles(fake, ids.bruno)).toEqual([]);
  });

  it("holds both buttons while the answer is on its way", async () => {
    const fake = server();
    const answer = later<Answer>();
    fake.next(roleRoute(ids.bruno), answer.promise as Answer);
    const user = userEvent.setup();
    render(<MemberPage id={ids.bruno} />);
    await user.click(
      await screen.findByRole("button", { name: "Tornar administrador" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Sim, tornar administrador" }),
    );

    const sending = screen.getByRole("button", { name: "Mudando…" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    answer.settle({ status: 204 });
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});

describe("Tirar de administrador", () => {
  it("takes another admin out while 2 admins remain", async () => {
    const fake = server({ joao: true });
    const user = userEvent.setup();
    render(<MemberPage id={ids.maria} />);

    await user.click(
      await screen.findByRole("button", { name: "Tirar de administrador" }),
    );
    expect(
      screen.getByText(
        "Tirar Maria de administrador? Maria continua votando, com o papel de Sócio.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sim, tirar" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "O papel de Maria agora é Sócio.",
    );
    expect(sentRoles(fake, ids.maria)).toEqual(["partner"]);
    // Back to 2 admins: Maria is a partner, offered to become one again.
    expect(
      screen.getByRole("button", { name: "Tornar administrador" }),
    ).toBeTruthy();
  });

  it("says why not, instead of the button, when only 2 admins are left", async () => {
    server();
    render(<MemberPage id={ids.maria} />);

    expect(
      await screen.findByText(
        "A sociedade precisa de pelo menos 2 administradores. Para tirar Maria, torne outro sócio administrador antes.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /administrador/ })).toBeNull();
  });

  it("says a 409 as the minimum: another admin got there first", async () => {
    const fake = server({ joao: true });
    fake.next(roleRoute(ids.maria), { status: 409 });
    const user = userEvent.setup();
    render(<MemberPage id={ids.maria} />);
    await user.click(
      await screen.findByRole("button", { name: "Tirar de administrador" }),
    );
    await user.click(screen.getByRole("button", { name: "Sim, tirar" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "A sociedade precisa de pelo menos 2 administradores.",
    );
    expect(screen.getByText("Administrador")).toBeTruthy();
  });

  it("says when it failed, and lets the admin try again", async () => {
    const fake = server({ joao: true });
    fake.next(roleRoute(ids.maria), "offline");
    const user = userEvent.setup();
    render(<MemberPage id={ids.maria} />);
    await user.click(
      await screen.findByRole("button", { name: "Tirar de administrador" }),
    );
    await user.click(screen.getByRole("button", { name: "Sim, tirar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão. Confira a internet e toque de novo.",
    );

    await user.click(
      screen.getByRole("button", { name: "Tirar de administrador" }),
    );
    await user.click(screen.getByRole("button", { name: "Sim, tirar" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "O papel de Maria agora é Sócio.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sentRoles(fake, ids.maria)).toEqual(["partner", "partner"]);
  });
});

describe("Deixar de ser administrador", () => {
  it("lets the admin step down, then leaves the admin screen", async () => {
    const fake = server({ joao: true });
    const user = userEvent.setup();
    render(<MemberPage id={ids.ana} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Deixar de ser administrador",
      }),
    );
    expect(
      screen.getByText(
        "Deixar de ser administrador? Você continua votando, com o papel de Sócio, mas não vê mais Membros e convites.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sim, deixar" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Você deixou de ser administrador. Agora o seu papel é Sócio.",
    );
    expect(sentRoles(fake, ids.ana)).toEqual(["partner"]);
    expect(
      screen
        .getByRole("link", { name: "← Voltar ao início" })
        .getAttribute("href"),
    ).toBe("/");
    // Every admin button would answer 403 now.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why not when only 2 admins are left", async () => {
    server();
    render(<MemberPage id={ids.ana} />);

    expect(
      await screen.findByText(
        "A sociedade precisa de pelo menos 2 administradores. Para deixar de ser, torne outro sócio administrador antes.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /administrador/ })).toBeNull();
  });
});

describe("a reader", () => {
  it("is told that a reader becomes a partner by a ballot, with no button", async () => {
    server();
    render(<MemberPage id={ids.caio} />);

    expect(
      await screen.findByText(
        "Um leitor vira sócio por votação de todos os sócios.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /administrador/ })).toBeNull();
  });
});

it("offers nothing about roles when the screen doesn't know who is looking", async () => {
  server({ who: "offline" });
  render(<MemberPage id={ids.bruno} />);
  await screen.findByRole("heading", { name: "Bruno" });

  expect(screen.queryByRole("button", { name: /administrador/ })).toBeNull();
});
