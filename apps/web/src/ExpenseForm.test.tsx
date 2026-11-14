// @vitest-environment jsdom
import type { CurrentProject, RecordedExpense } from "@partneroj/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExpenseForm } from "./ExpenseForm";
import { localDate } from "./expenseForm";
import { type Answer, fakeServer, later } from "./testing";

// The contract checks ids as uuids before anything is sent.
const ids = {
  project: "01a1c25b-7bf8-7cea-b37d-5194960ba97f",
  material: "01a1c25b-7bf8-7cea-b37d-5194960ba980",
  taxas: "01a1c25b-7bf8-7cea-b37d-5194960ba981",
  entry: "01a1c25b-7bf8-7cea-b37d-5194960ba982",
};

const current: CurrentProject = {
  project: { id: ids.project, name: "Casa" },
  categories: [
    { id: ids.material, name: "Material" },
    { id: ids.taxas, name: "Taxas" },
  ],
};

const today = localDate(new Date());

const recorded = (amountCents = "1250"): RecordedExpense => ({
  id: ids.entry,
  amountCents,
  occurredOn: today,
});

const routes = {
  project: "GET /api/projects/current",
  save: "POST /api/entries/expenses",
  upload: `POST /api/entries/${ids.entry}/receipts`,
};

/**
 * The fake API (testing.ts) with this screen's routes: the project loads,
 * saves and uploads succeed unless a test queues something else first.
 */
function expenseServer(project: Answer = { status: 200, body: current }) {
  const server = fakeServer({
    [routes.project]: project,
    [routes.save]: { status: 201, body: recorded() },
    [routes.upload]: { status: 201, body: { id: "r1" } },
  });
  const saved = () => server.sent(routes.save);
  return {
    nextSave: (...answers: Answer[]) => server.next(routes.save, ...answers),
    nextUpload: (...answers: Answer[]) =>
      server.next(routes.upload, ...answers),
    saved,
    uploaded: () => server.sent(routes.upload),
    /** The Idempotency-Key of each save, in order. */
    keys: () => saved().map((s) => s.headers.get("Idempotency-Key")),
    /** The JSON body of each save, in order. */
    bodies: () => saved().map((s) => JSON.parse(s.body as string) as unknown),
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Opens the screen and waits for the project to load. */
async function open() {
  const user = userEvent.setup();
  render(<ExpenseForm />);
  await screen.findByRole("heading", { name: "Fiz um gasto" });
  return user;
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  amount = "12,50",
  category = "Material",
) {
  const field = screen.getByLabelText("Valor (R$)");
  await user.clear(field);
  await user.type(field, amount);
  await user.click(screen.getByRole("button", { name: category }));
}

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Salvar" }));

describe("Fiz um gasto", () => {
  it("saves the expense in cents, today, with a key, and says so", async () => {
    const server = expenseServer();
    const user = await open();
    expect(screen.getByText("Casa")).toBeTruthy();
    await fill(user);
    await user.type(screen.getByLabelText(/Descrição/), "cimento");
    await save(user);

    await screen.findByRole("heading", { name: "Gasto salvo." });
    expect(screen.getByText("R$ 12,50")).toBeTruthy();
    expect(server.bodies()).toEqual([
      {
        projectId: ids.project,
        amountCents: "1250",
        categoryId: ids.material,
        occurredOn: today,
        description: "cimento",
      },
    ]);
    expect(server.keys()[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("shows what is missing and sends nothing", async () => {
    const server = expenseServer();
    const user = await open();
    await save(user);
    expect(screen.getByText("Digite o valor, por exemplo 12,50.")).toBeTruthy();
    expect(screen.getByText("Escolha o que foi.")).toBeTruthy();
    expect(
      screen.getByLabelText("Valor (R$)").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(server.saved()).toEqual([]);
  });

  it("marks the chosen category as pressed", async () => {
    expenseServer();
    const user = await open();
    const material = screen.getByRole("button", { name: "Material" });
    await user.click(material);
    expect(material.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Taxas" }));
    expect(material.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the save's key", () => {
  it("is the same when Salvar is tapped again after no answer", async () => {
    const server = expenseServer();
    server.nextSave("offline");
    const user = await open();
    await fill(user);
    await save(user);
    await screen.findByText(
      "Sem conexão. Confira a internet e toque em Salvar de novo.",
    );
    await save(user);

    await screen.findByRole("heading", { name: "Gasto salvo." });
    const [first, again] = server.keys();
    expect(again).toBe(first);
  });

  it("changes when the draft is edited after a failure", async () => {
    const server = expenseServer();
    server.nextSave("offline");
    const user = await open();
    await fill(user);
    await save(user);
    await screen.findByRole("alert");
    await fill(user, "13,00");
    await save(user);

    await screen.findByRole("heading", { name: "Gasto salvo." });
    const [first, edited] = server.keys();
    expect(edited).not.toBe(first);
    expect(
      server.bodies().map((b) => (b as { amountCents: string }).amountCents),
    ).toEqual(["1250", "1300"]);
  });

  it("changes after a 409, so tapping again can save", async () => {
    const server = expenseServer();
    server.nextSave({ status: 409 });
    const user = await open();
    await fill(user);
    await save(user);
    await screen.findByText(
      "Algo deu errado e o gasto não foi salvo. Toque em Salvar de novo.",
    );
    await save(user);

    await screen.findByRole("heading", { name: "Gasto salvo." });
    const [first, again] = server.keys();
    expect(again).not.toBe(first);
    const [body1, body2] = server.bodies();
    expect(body2).toEqual(body1);
  });

  it("is new for the next expense, which keeps the date", async () => {
    const server = expenseServer();
    const user = await open();
    await fill(user);
    await save(user);
    await user.click(
      await screen.findByRole("button", { name: "Fiz outro gasto" }),
    );

    expect(screen.getByLabelText<HTMLInputElement>("Valor (R$)").value).toBe(
      "",
    );
    expect(screen.getByLabelText<HTMLInputElement>("Data").value).toBe(today);
    await fill(user);
    await save(user);
    await screen.findByRole("heading", { name: "Gasto salvo." });
    const [first, next] = server.keys();
    expect(next).not.toBe(first);
  });
});

it("sends one save for two taps while the first is on its way", async () => {
  const server = expenseServer();
  const answer = later<{ status: number; body: unknown }>();
  server.nextSave(answer.promise);
  const user = await open();
  await fill(user);
  const form = screen.getByRole("button", { name: "Salvar" }).closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);

  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Salvando…" })
      .disabled,
  ).toBe(true);
  answer.settle({ status: 201, body: recorded() });
  await screen.findByRole("heading", { name: "Gasto salvo." });
  expect(server.saved()).toHaveLength(1);
});

describe.each([
  [401, "Você saiu do Partneroj. Abra o app de novo para entrar."],
  [403, "Seu acesso não permite registrar gastos neste projeto."],
  [422, "Seu acesso não permite registrar gastos neste projeto."],
  [404, "Este projeto não aceita mais gastos. Volte ao início."],
  [500, "Algo deu errado e o gasto não foi salvo. Toque em Salvar de novo."],
])("a save answered %i", (status, text) => {
  it("says why, and the draft stays", async () => {
    const server = expenseServer();
    server.nextSave({ status });
    const user = await open();
    await fill(user);
    await save(user);
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(screen.getByLabelText<HTMLInputElement>("Valor (R$)").value).toBe(
      "12,50",
    );
  });
});

describe("the receipt", () => {
  const pdf = () =>
    new File(["%PDF-1.7"], "nota.pdf", { type: "application/pdf" });

  it("goes up after the expense is saved, to that expense", async () => {
    const server = expenseServer();
    const user = await open();
    await fill(user);
    await user.upload(screen.getByLabelText("Escolher arquivo"), pdf());
    expect(screen.getByText("nota.pdf")).toBeTruthy();
    await save(user);

    await screen.findByText("Foto do comprovante enviada.");
    // To the expense just saved: the route carries its id.
    const [upload] = server.uploaded();
    expect(upload!.headers.get("Content-Type")).toBe("application/pdf");
    expect((upload!.body as File).name).toBe("nota.pdf");
  });

  it("can be sent again when the upload fails, the expense saved", async () => {
    const server = expenseServer();
    server.nextUpload("offline");
    const user = await open();
    await fill(user);
    await user.upload(screen.getByLabelText("Escolher arquivo"), pdf());
    await save(user);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão, e a foto não foi enviada. O gasto já está salvo.",
    );
    await user.click(
      screen.getByRole("button", { name: "Enviar a foto de novo" }),
    );
    await screen.findByText("Foto do comprovante enviada.");
    expect(server.saved()).toHaveLength(1);
  });

  it("refuses a file that is not a photo or PDF, before saving", async () => {
    expenseServer();
    const user = userEvent.setup({ applyAccept: false });
    render(<ExpenseForm />);
    await screen.findByRole("heading", { name: "Fiz um gasto" });
    await user.upload(
      screen.getByLabelText("Escolher arquivo"),
      new File(["a,b"], "planilha.csv", { type: "text/csv" }),
    );
    const field = screen.getByRole("group", { name: /Comprovante/ });
    expect(within(field).getByRole("alert").textContent).toBe(
      "Escolha uma foto ou um PDF.",
    );
  });

  it("can still be sent from 'Gasto salvo.' when forgotten", async () => {
    const server = expenseServer();
    const user = await open();
    await fill(user);
    await save(user);
    await screen.findByText("Esqueceu o comprovante?");
    await user.upload(screen.getByLabelText("Escolher arquivo"), pdf());

    await screen.findByText("Foto do comprovante enviada.");
    // To the expense just saved: the route carries its id.
    expect(server.uploaded()).toHaveLength(1);
  });
});

describe.each([
  [
    { status: 404 },
    "Ainda não há um projeto aberto. Peça a um administrador para criar um.",
  ],
  [{ status: 401 }, "Você saiu do Partneroj. Abra o app de novo para entrar."],
  ["offline" as const, "Sem conexão. Confira a internet e abra de novo."],
  [{ status: 500 }, "Algo deu errado. Tente de novo daqui a pouco."],
])("no project to record into (%o)", (answer, text) => {
  it("says why instead of the form", async () => {
    expenseServer(answer);
    render(<ExpenseForm />);
    expect((await screen.findByRole("alert")).textContent).toBe(text);
    expect(screen.queryByLabelText("Valor (R$)")).toBeNull();
  });
});
