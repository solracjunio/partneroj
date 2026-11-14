import { describe, expect, it } from "vitest";

import { clickTarget, notificationFrom } from "./notification";

const message = {
  title: "João lançou R$ 1.200,00",
  body: "Material: cimento e areia",
  tag: "01a1c25b-7bf8-7cea-b37d-5194960ba97f",
  url: "/lancamento/01a1c25b-7bf8-7cea-b37d-5194960ba97f",
};

describe("notificationFrom", () => {
  it("shows the worker's message, tagged with the event's id", () => {
    expect(notificationFrom(JSON.stringify(message))).toEqual({
      title: message.title,
      options: {
        body: message.body,
        tag: message.tag,
        icon: "/pwa-192x192.png",
        data: { url: message.url },
      },
    });
  });

  // Chrome requires a notification for every push, so something always
  // shows, and the feed holds the details.
  it.each([
    ["no payload", null],
    ["text that is not JSON", "olá"],
    ["JSON that is not a message", JSON.stringify({ title: 1 })],
    [
      "a message without a body",
      JSON.stringify({ ...message, body: undefined }),
    ],
  ])("falls back to a fixed text on %s", (_case, text) => {
    expect(notificationFrom(text)).toEqual({
      title: "Partneroj",
      options: {
        body: "Nova movimentação. Toque para ver.",
        icon: "/pwa-192x192.png",
        data: { url: "/atividades" },
      },
    });
  });
});

describe("clickTarget", () => {
  it("opens the path the message names", () => {
    expect(clickTarget({ url: message.url })).toBe(message.url);
  });

  it.each([
    ["another site", "https://example.com/"],
    ["a protocol-relative URL", "//example.com/"],
    ["a backslash trick", "/\\example.com"],
    ["a script", "javascript:alert(1)"],
    ["a relative path", "lancamento/x"],
    ["no url", undefined],
  ])("opens the feed instead of %s", (_case, url) => {
    expect(clickTarget({ url })).toBe("/atividades");
  });

  it("opens the feed when the data is missing", () => {
    expect(clickTarget(null)).toBe("/atividades");
  });
});
