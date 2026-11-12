import { describe, expect, it } from "vitest";

import { inviteLink, matchRoute } from "./routes";

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
