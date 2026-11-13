import { describe, expect, it } from "vitest";

import { entryLink, inviteLink, matchRoute } from "./routes";

const token = "OkusGjZ1yakES04LodPZ3cPKyaMiDC0COzKAQKulFzA";

describe("matchRoute", () => {
  it("opens the home page at the root", () => {
    expect(matchRoute("/")).toEqual({ page: "home" });
  });

  it("opens an invite from its link, with or without a final slash", () => {
    expect(matchRoute(`/convite/${token}`)).toEqual({ page: "invite", token });
    expect(matchRoute(`/convite/${token}/`)).toEqual({ page: "invite", token });
  });

  it("opens the expense form", () => {
    expect(matchRoute("/gasto")).toEqual({ page: "expense" });
    expect(matchRoute("/gasto/")).toEqual({ page: "expense" });
  });

  it("opens the feed", () => {
    expect(matchRoute("/atividades")).toEqual({ page: "feed" });
    expect(matchRoute("/atividades/")).toEqual({ page: "feed" });
  });

  it("opens an entry from its link, and reads back the link it makes", () => {
    const id = "0196f3a2-7c1e-7b3d-9a4f-2e8c5d6b1a09";
    expect(matchRoute(`/lancamento/${id}`)).toEqual({ page: "entry", id });
    expect(matchRoute(`/lancamento/${id}/`)).toEqual({ page: "entry", id });
    expect(matchRoute(entryLink(id))).toEqual({ page: "entry", id });
    expect(matchRoute(`/lancamento/${id.toUpperCase()}`)).toEqual({
      page: "entry",
      id,
    });
  });

  it("finds nothing at an entry link without a valid id", () => {
    expect(matchRoute("/lancamento/")).toEqual({ page: "not-found" });
    expect(matchRoute("/lancamento/abc")).toEqual({ page: "not-found" });
  });

  it("finds nothing elsewhere", () => {
    expect(matchRoute("/convite/")).toEqual({ page: "not-found" });
    expect(matchRoute("/convite/a/b")).toEqual({ page: "not-found" });
    expect(matchRoute("/outra")).toEqual({ page: "not-found" });
  });

  it("reads back the link it makes", () => {
    const link = new URL(inviteLink("https://example.test", token));
    expect(matchRoute(link.pathname)).toEqual({ page: "invite", token });
  });
});
