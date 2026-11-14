// @vitest-environment jsdom
import type { EntryDetails } from "@partneroj/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "./api";
import { EntryPage } from "./EntryPage";
import { entryLink } from "./routes";
import { type Answer, fakeServer, later } from "./testing";

const ids = {
  me: "01a1c25b-7bf8-7cea-b37d-5194960ba990",
  other: "01a1c25b-7bf8-7cea-b37d-5194960ba991",
  partnership: "01a1c25b-7bf8-7cea-b37d-5194960ba992",
  entry: "01a1c25b-7bf8-7cea-b37d-5194960ba993",
  reversal: "01a1c25b-7bf8-7cea-b37d-5194960ba994",
  receipt: "01a1c25b-7bf8-7cea-b37d-5194960ba995",
};

const me: Me = {
  memberId: ids.me,
  partnershipId: ids.partnership,
  name: "Ana",
  role: "partner",
};

/** An expense the signed-in member paid and recorded, still confirmed. */
const confirmed = (overrides: Partial<EntryDetails> = {}): EntryDetails => ({
  id: ids.entry,
  type: "expense",
  amountCents: "15000",
  occurredOn: "2026-11-10",
  category: "Material",
  description: "cimento",
  paidBy: { id: ids.me, name: "Ana" },
  author: { id: ids.me, name: "Ana" },
  recordedAt: "2026-11-10T12:00:00.000Z",
  receipts: [],
  status: "confirmed",
  reversal: null,
  reversalOf: null,
  canReverse: true,
  canAddReceipt: true,
  ...overrides,
});

/** The same expense after its author undid it. */
const reversed = (): EntryDetails =>
  confirmed({
    status: "reversed",
    reversal: {
      id: ids.reversal,
      reason: "lancei duas vezes",
      at: "2026-11-11T12:00:00.000Z",
      by: { id: ids.me, name: "Ana" },
    },
    canReverse: false,
  });

const routes = {
  me: "GET /api/me",
  entry: `GET /api/entries/${ids.entry}`,
  reverse: `POST /api/entries/${ids.entry}/reverse`,
  upload: `POST /api/entries/${ids.entry}/receipts`,
};

const ok = (body: unknown) => ({ status: 200, body });

/** The fake API (testing.ts): the entry loads, undo and upload succeed. */
function entryServer(entry: Answer = ok(confirmed())) {
  return fakeServer({
    [routes.me]: ok(me),
    [routes.entry]: entry,
    [routes.reverse]: { status: 201, body: { id: ids.reversal } },
    [routes.upload]: {
      status: 201,
      body: { id: ids.receipt, contentType: "application/pdf", sizeBytes: 8 },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens the entry's screen and waits for it to load. */
async function open(options?: Parameters<typeof userEvent.setup>[0]) {
  const user = userEvent.setup(options);
  render(<EntryPage id={ids.entry} />);
  await screen.findByRole("heading", { name: /R\$ 150,00/ });
  return user;
}

/** The value next to a label in the facts list. */
function fact(label: string): string | null {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? null;
}

describe("the entry", () => {
  it("shows what, who paid, who recorded and that it stands", async () => {
    entryServer();
    await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Gasto de R$ 150,00 em Material",
    );
    expect(screen.getByText("Confirmado")).toBeTruthy();
    expect(fact("Quem pagou")).toBe("Você");
    expect(fact("Dia do gasto")).toBe("10/11/2026");
    expect(fact("Descrição")).toBe('"cimento"');
    expect(screen.getByText("Sem comprovante.")).toBeTruthy();
  });

  it("names the payer when it was another partner", async () => {
    entryServer(ok(confirmed({ paidBy: { id: ids.other, name: "Bruno" } })));
    await open();
    expect(fact("Quem pagou")).toBe("Bruno");
  });

  it("links each receipt to its file", async () => {
    entryServer(
      ok(
        confirmed({
          receipts: [{ id: ids.receipt, contentType: "application/pdf" }],
        }),
      ),
    );
    await open();
    const link = screen.getByRole("link", { name: "Ver comprovante (PDF)" });
    expect(link.getAttribute("href")).toBe(`/api/receipts/${ids.receipt}`);
    expect(
      screen.getByRole("group", { name: "Adicionar outro comprovante" }),
    ).toBeTruthy();
  });

  it("offers neither undo nor a receipt when the server says no", async () => {
    entryServer(ok(confirmed({ canReverse: false, canAddReceipt: false })));
    await open();
    expect(
      screen.queryByRole("button", { name: "Desfazer este gasto" }),
    ).toBeNull();
    expect(screen.queryByRole("group", { name: /comprovante/ })).toBeNull();
  });

  it("links an undone entry and its reversal to each other", async () => {
    entryServer(ok(reversed()));
    await open();
    expect(
      screen
        .getByRole("link", { name: "Ver o lançamento que desfez ▸" })
        .getAttribute("href"),
    ).toBe(entryLink(ids.reversal));
    cleanup();

    entryServer(
      ok(
        confirmed({
          id: ids.reversal,
          amountCents: "-15000",
          reversalOf: ids.entry,
          canReverse: false,
        }),
      ),
    );
    render(<EntryPage id={ids.entry} />);
    const back = await screen.findByRole("link", {
      name: "Ver o gasto que foi desfeito ▸",
    });
    expect(back.getAttribute("href")).toBe(entryLink(ids.entry));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Desfaz um gasto de R$ 150,00 em Material",
    );
  });
});

describe("opening it fails", () => {
  it("says the entry was not found, with nothing to retry", async () => {
    entryServer({ status: 404 });
    render(<EntryPage id={ids.entry} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Este lançamento não foi encontrado.",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("can be tried again without a connection", async () => {
    const server = entryServer();
    server.next(routes.entry, "offline");
    const user = userEvent.setup();
    render(<EntryPage id={ids.entry} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão. Confira a internet e toque em Tentar de novo.",
    );
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("heading", { name: /R\$ 150,00/ });
  });

  it("says so when the session is gone", async () => {
    const server = entryServer();
    server.next(routes.me, { status: 401 });
    render(<EntryPage id={ids.entry} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Você saiu do Partneroj. Abra o app de novo para entrar.",
    );
  });
});

describe("Desfazer", () => {
  const undo = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: "Desfazer este gasto" }));
  const confirm = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: "Confirmar: desfazer" }));

  it("asks why first: one tap sends nothing, and Cancelar closes", async () => {
    const server = entryServer();
    const user = await open();
    await undo(user);
    expect(screen.getByLabelText("Por que desfazer?")).toBeTruthy();
    expect(server.sent(routes.reverse)).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Por que desfazer?")).toBeNull();
  });

  it("refuses an empty reason without sending", async () => {
    const server = entryServer();
    const user = await open();
    await undo(user);
    await user.type(screen.getByLabelText("Por que desfazer?"), "   ");
    await confirm(user);
    expect(
      screen.getByText("Escreva por que está desfazendo este gasto."),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Por que desfazer?").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(server.sent(routes.reverse)).toEqual([]);
  });

  it("sends the trimmed reason and shows the server's state after", async () => {
    const server = entryServer();
    server.next(routes.entry, ok(confirmed()), ok(reversed()));
    const user = await open();
    await undo(user);
    await user.type(
      screen.getByLabelText("Por que desfazer?"),
      "  lancei duas vezes ",
    );
    await confirm(user);

    expect((await screen.findByRole("status")).textContent).toBe(
      "Gasto desfeito. Os outros sócios vão ver o motivo nas atividades.",
    );
    const [sent] = server.sent(routes.reverse);
    expect(JSON.parse(sent!.body as string)).toEqual({
      reason: "lancei duas vezes",
    });
    expect(await screen.findByText("Desfeito")).toBeTruthy();
    expect(screen.getByText('Motivo: "lancei duas vezes"')).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Desfazer este gasto" }),
    ).toBeNull();
  });

  it("shows who undid it first when the server answers 409", async () => {
    const server = entryServer();
    server.next(routes.entry, ok(confirmed()), ok(reversed()));
    server.next(routes.reverse, { status: 409 });
    const user = await open();
    await undo(user);
    await user.type(screen.getByLabelText("Por que desfazer?"), "errei");
    await confirm(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Este gasto já tinha sido desfeito. Veja acima quem desfez.",
    );
    expect(await screen.findByText("Desfeito")).toBeTruthy();
    expect(server.sent(routes.entry)).toHaveLength(2);
  });

  it("undoes nothing without a connection, and keeps the reason", async () => {
    const server = entryServer();
    server.next(routes.reverse, "offline");
    const user = await open();
    await undo(user);
    await user.type(screen.getByLabelText("Por que desfazer?"), "errei");
    await confirm(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão. Nada foi desfeito. Confira a internet e tente de novo.",
    );
    // Nothing changed on the server, so nothing is reloaded.
    expect(server.sent(routes.entry)).toHaveLength(1);
    await undo(user);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Por que desfazer?").value,
    ).toBe("errei");
  });

  it("can't be sent twice while the first is on its way", async () => {
    const server = entryServer();
    const answer = later<Answer>();
    server.next(routes.reverse, answer.promise as Answer);
    const user = await open();
    await undo(user);
    await user.type(screen.getByLabelText("Por que desfazer?"), "errei");
    await confirm(user);

    const sending = screen.getByRole<HTMLButtonElement>("button", {
      name: "Desfazendo…",
    });
    expect(sending.disabled).toBe(true);
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("Por que desfazer?").disabled,
    ).toBe(true);
    answer.settle({ status: 201, body: { id: ids.reversal } });
    await screen.findByRole("status");
    expect(server.sent(routes.reverse)).toHaveLength(1);
  });
});

describe("Adicionar comprovante", () => {
  const pdf = () =>
    new File(["%PDF-1.7"], "nota.pdf", { type: "application/pdf" });
  const group = () =>
    within(screen.getByRole("group", { name: /comprovante/ }));

  it("shows the file first and sends it only on 'Enviar'", async () => {
    const server = entryServer();
    server.next(
      routes.entry,
      ok(confirmed()),
      ok(
        confirmed({
          receipts: [{ id: ids.receipt, contentType: "application/pdf" }],
        }),
      ),
    );
    const user = await open();
    await user.upload(group().getByLabelText("Escolher arquivo"), pdf());
    expect(group().getByText("nota.pdf")).toBeTruthy();
    expect(server.sent(routes.upload)).toEqual([]);

    await user.click(
      group().getByRole("button", { name: "Enviar este comprovante" }),
    );
    expect(await group().findByRole("status")).toBeTruthy();
    expect(group().getByRole("status").textContent).toBe(
      "Comprovante adicionado.",
    );
    const [upload] = server.sent(routes.upload);
    expect(upload!.headers.get("Content-Type")).toBe("application/pdf");
    // The entry reloads, so its list shows the new receipt.
    expect(
      await screen.findByRole("link", { name: "Ver comprovante (PDF)" }),
    ).toBeTruthy();
  });

  it("can be sent again after a lost connection", async () => {
    const server = entryServer();
    server.next(routes.upload, "offline");
    const user = await open();
    await user.upload(group().getByLabelText("Escolher arquivo"), pdf());
    await user.click(
      group().getByRole("button", { name: "Enviar este comprovante" }),
    );
    expect((await group().findByRole("alert")).textContent).toBe(
      "Sem conexão, e a foto não foi enviada.",
    );
    await user.click(group().getByRole("button", { name: "Enviar de novo" }));
    await group().findByText("Comprovante adicionado.");
    expect(server.sent(routes.upload)).toHaveLength(2);
  });

  it("offers another file, not a retry, when the server refuses it", async () => {
    const server = entryServer();
    server.next(routes.upload, { status: 415 });
    const user = await open();
    await user.upload(group().getByLabelText("Escolher arquivo"), pdf());
    await user.click(
      group().getByRole("button", { name: "Enviar este comprovante" }),
    );
    expect((await group().findByRole("alert")).textContent).toBe(
      "O servidor não aceitou este arquivo.",
    );
    expect(
      group().queryByRole("button", { name: "Enviar de novo" }),
    ).toBeNull();
    await user.click(group().getByRole("button", { name: "Escolher outro" }));
    expect(group().getByLabelText("Escolher arquivo")).toBeTruthy();
    expect(server.sent(routes.upload)).toHaveLength(1);
  });

  it("goes back to choosing without sending, and after one sent", async () => {
    const server = entryServer();
    const user = await open();
    await user.upload(group().getByLabelText("Escolher arquivo"), pdf());
    await user.click(group().getByRole("button", { name: "Escolher outro" }));
    expect(server.sent(routes.upload)).toEqual([]);

    await user.upload(group().getByLabelText("Escolher arquivo"), pdf());
    await user.click(
      group().getByRole("button", { name: "Enviar este comprovante" }),
    );
    await user.click(
      await group().findByRole("button", { name: "Adicionar mais um" }),
    );
    expect(group().getByLabelText("Escolher arquivo")).toBeTruthy();
  });

  it("refuses a file that is not a photo or PDF", async () => {
    const server = entryServer();
    const user = await open({ applyAccept: false });
    await user.upload(
      group().getByLabelText("Escolher arquivo"),
      new File(["a,b"], "planilha.csv", { type: "text/csv" }),
    );
    expect(group().getByRole("alert").textContent).toBe(
      "Escolha uma foto ou um PDF.",
    );
    expect(server.sent(routes.upload)).toEqual([]);
  });
});
