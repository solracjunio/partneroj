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
    [500, "error"],
  ])("turns a %i into %s", async (status, failure) => {
    answer(status);
    expect(await api.me()).toEqual({ ok: false, failure });
  });

  it("tells when there is no connection", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    expect(await api.me()).toEqual({ ok: false, failure: "offline" });
  });
});
