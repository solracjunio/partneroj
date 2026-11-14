// @vitest-environment jsdom
import type { Feed, FeedItem } from "@partneroj/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "./api";
import { FeedPage } from "./FeedPage";
import { entryLink } from "./routes";
import { type Answer, fakeServer } from "./testing";

const ids = {
  me: "01a1c25b-7bf8-7cea-b37d-5194960ba9b0",
  other: "01a1c25b-7bf8-7cea-b37d-5194960ba9b1",
  entry: "01a1c25b-7bf8-7cea-b37d-5194960ba9b2",
  receipt: "01a1c25b-7bf8-7cea-b37d-5194960ba9b3",
};

const me: Me = {
  memberId: ids.me,
  partnershipId: "01a1c25b-7bf8-7cea-b37d-5194960ba9b4",
  name: "Ana",
  role: "partner",
};

/** Activity ids end in their position, so pages are easy to tell apart. */
const activityId = (n: number) =>
  `01a1c25b-7bf8-7cea-b37d-${String(n).padStart(12, "0")}`;

/** Another partner's expense, with a receipt. */
const expense = (n: number, unread = false): FeedItem => ({
  id: activityId(n),
  action: "entry_recorded",
  at: "2026-11-10T12:00:00.000Z",
  actor: { id: ids.other, name: "Bruno" },
  unread,
  entry: {
    id: ids.entry,
    type: "expense",
    amountCents: "15000",
    occurredOn: "2026-11-10",
    category: "Material",
    description: null,
    reversalOf: null,
    reversalReason: null,
    reversedBy: null,
    receipts: [{ id: ids.receipt, contentType: "application/pdf" }],
  },
});

const joined = (n: number): FeedItem => ({
  id: activityId(n),
  action: "member_joined",
  at: "2026-11-09T12:00:00.000Z",
  actor: { id: ids.me, name: "Ana" },
  unread: false,
  entry: null,
});

const page = (items: FeedItem[], next: string | null = null) => ({
  status: 200,
  body: { items, next } satisfies Feed,
});

const routes = {
  me: "GET /api/me",
  first: "GET /api/activities",
  read: "POST /api/activities/read",
  after: (n: number) =>
    `GET /api/activities?before=${encodeURIComponent(activityId(n))}`,
};

function feedServer(first: Answer, more: Record<string, Answer> = {}) {
  return fakeServer({
    [routes.me]: { status: 200, body: me },
    [routes.first]: first,
    [routes.read]: { status: 204 },
    ...more,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const items = () => within(screen.getByRole("list")).getAllByRole("listitem");

describe("Atividades", () => {
  it("shows each activity with who, what, the receipt and the details", async () => {
    feedServer(page([expense(1, true)]));
    render(<FeedPage />);
    await screen.findByText("Bruno fez um gasto de R$ 150,00 em Material.");
    const [item] = items();
    expect(within(item!).getByText("Novo")).toBeTruthy();
    expect(
      within(item!)
        .getByRole("link", { name: "Ver comprovante (PDF)" })
        .getAttribute("href"),
    ).toBe(`/api/receipts/${ids.receipt}`);
    expect(
      within(item!)
        .getByRole("link", { name: "Ver detalhes ▸" })
        .getAttribute("href"),
    ).toBe(entryLink(ids.entry));
  });

  it("gives a joined member no details link", async () => {
    feedServer(page([joined(1)]));
    render(<FeedPage />);
    await screen.findByText("Você entrou no Partneroj.");
    expect(screen.queryByRole("link", { name: "Ver detalhes ▸" })).toBeNull();
  });

  it("says when nothing happened yet", async () => {
    feedServer(page([]));
    render(<FeedPage />);
    expect(await screen.findByText("Nada aconteceu ainda.")).toBeTruthy();
  });
});

describe("marking as read", () => {
  it("marks only the new activities shown as read", async () => {
    const server = feedServer(
      page([expense(1, true), expense(2), expense(3, true)]),
    );
    render(<FeedPage />);
    await screen.findAllByText("Bruno fez um gasto de R$ 150,00 em Material.");
    const [sent] = server.sent(routes.read);
    expect(JSON.parse(sent!.body as string)).toEqual({
      ids: [activityId(1), activityId(3)],
    });
  });

  it("sends nothing when nothing is new", async () => {
    const server = feedServer(page([expense(1)]));
    render(<FeedPage />);
    await screen.findByText("Bruno fez um gasto de R$ 150,00 em Material.");
    expect(server.sent(routes.read)).toEqual([]);
  });
});

describe("older pages", () => {
  it("adds the next page below, until the last one", async () => {
    const server = feedServer(page([expense(1)], activityId(1)), {
      [routes.after(1)]: page([joined(2)]),
    });
    const user = userEvent.setup();
    render(<FeedPage />);
    await user.click(
      await screen.findByRole("button", { name: "Ver mais antigas" }),
    );

    await screen.findByText("Você entrou no Partneroj.");
    expect(items()).toHaveLength(2);
    expect(server.sent(routes.after(1))).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Ver mais antigas" }),
    ).toBeNull();
  });

  it("can try the next page again, keeping the ones shown", async () => {
    const server = feedServer(page([expense(1)], activityId(1)), {
      [routes.after(1)]: page([joined(2)]),
    });
    server.next(routes.after(1), "offline");
    const user = userEvent.setup();
    render(<FeedPage />);
    await user.click(
      await screen.findByRole("button", { name: "Ver mais antigas" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sem conexão. Confira a internet e toque em Tentar de novo.",
    );
    expect(items()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await screen.findByText("Você entrou no Partneroj.");
    expect(items()).toHaveLength(2);
  });
});

describe("opening it fails", () => {
  it("can be tried again without a connection", async () => {
    const server = feedServer(page([expense(1)]));
    server.next(routes.first, "offline");
    const user = userEvent.setup();
    render(<FeedPage />);
    await user.click(
      await screen.findByRole("button", { name: "Tentar de novo" }),
    );
    expect(
      await screen.findByText("Bruno fez um gasto de R$ 150,00 em Material."),
    ).toBeTruthy();
  });

  it("offers no retry when the session is gone", async () => {
    feedServer({ status: 401 }, { [routes.me]: { status: 401 } });
    render(<FeedPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Você saiu do Partneroj. Abra o app de novo para entrar.",
    );
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });
});
