import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    () =>
      Promise.resolve(
        new Response(body === undefined ? null : JSON.stringify(body), {
          status,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("reads an invite preview from /api, without changing anything", async () => {
    const fetch = answer(200, { memberName: "Maria", partnershipName: "Obra" });
    expect(await api.previewInvite("abc")).toEqual({
      ok: true,
      value: { memberName: "Maria", partnershipName: "Obra" },
    });
    expect(fetch).toHaveBeenCalledWith("/api/invites/abc", {});
  });

  it("accepts an invite with a POST", async () => {
    const fetch = answer(204);
    expect(await api.acceptInvite("abc")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(fetch).toHaveBeenCalledWith("/api/auth/invites/abc/accept", {
      method: "POST",
    });
  });

  it.each([
    [404, "unusable"],
    [401, "signed-out"],
    [403, "refused"],
    [422, "refused"],
    [413, "unsupported"],
    [415, "unsupported"],
    [409, "conflict"],
    [500, "error"],
  ])("turns a %i into %s", async (status, failure) => {
    answer(status);
    expect(await api.me()).toEqual({ ok: false, failure });
  });

  it("reads the current project and its categories", async () => {
    const current = {
      project: { id: "p", name: "Obra" },
      categories: [{ id: "c", name: "Material" }],
    };
    const fetch = answer(200, current);
    expect(await api.currentProject()).toEqual({ ok: true, value: current });
    expect(fetch).toHaveBeenCalledWith("/api/projects/current", {});
  });

  it("records an expense with a JSON POST", async () => {
    const recorded = { id: "e", amountCents: "1250", occurredOn: "2026-11-09" };
    const fetch = answer(201, recorded);
    const body = {
      projectId: "p",
      amountCents: "1250",
      categoryId: "c",
      occurredOn: "2026-11-09",
    };
    expect(await api.recordExpense(body)).toEqual({
      ok: true,
      value: recorded,
    });
    expect(fetch).toHaveBeenCalledWith("/api/entries/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("reads the feed, and the next page from a cursor", async () => {
    const fetch = answer(200, { items: [], next: null });
    expect(await api.feed()).toEqual({
      ok: true,
      value: { items: [], next: null },
    });
    expect(fetch).toHaveBeenCalledWith("/api/activities", {});
    await api.feed("0196-abc");
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/activities?before=0196-abc",
      {},
    );
  });

  it("reads the unread count and marks activities read", async () => {
    const fetch = answer(200, { count: 2 });
    expect(await api.unreadCount()).toEqual({ ok: true, value: { count: 2 } });
    expect(fetch).toHaveBeenCalledWith("/api/activities/unread", {});
    const marked = answer(204);
    expect(await api.markRead({ ids: ["a"] })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(marked).toHaveBeenCalledWith("/api/activities/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["a"] }),
    });
  });

  it("tells when there is no connection", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    expect(await api.me()).toEqual({ ok: false, failure: "offline" });
  });

  it("sends a receipt as the whole body, with its type", async () => {
    const added = { id: "r", contentType: "image/jpeg", sizeBytes: 3 };
    const fetch = answer(201, added);
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    expect(await api.addReceipt("e1", file)).toEqual({
      ok: true,
      value: added,
    });
    expect(fetch).toHaveBeenCalledWith("/api/entries/e1/receipts", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: file,
    });
  });

  it("reads one entry and undoes it with a reason", async () => {
    const fetch = answer(200, { id: "e1" });
    expect(await api.entry("e1")).toEqual({ ok: true, value: { id: "e1" } });
    expect(fetch).toHaveBeenCalledWith("/api/entries/e1", {});
    const reversal = { id: "r1", reversalOf: "e1", amountCents: "-1250" };
    const undo = answer(201, reversal);
    expect(await api.reverseEntry("e1", { reason: "valor errado" })).toEqual({
      ok: true,
      value: reversal,
    });
    expect(undo).toHaveBeenCalledWith("/api/entries/e1/reverse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "valor errado" }),
    });
  });
});
