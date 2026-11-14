// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationsCard } from "./NotificationsCard";
import { keyBytes } from "./push";
import {
  type Answer,
  browserSubscription,
  fakePushBrowser,
  fakeServer,
} from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 65 bytes, as a real P-256 public key, in base64url.
const publicKey = "BAEC" + "A".repeat(83);

const KEY = "GET /api/notifications/vapid-key";
const SAVE = "PUT /api/notifications/subscription";
const REMOVE = "DELETE /api/notifications/subscription";

function server(routes: Record<string, Answer> = {}) {
  return fakeServer({
    [KEY]: { status: 200, body: { publicKey } },
    [SAVE]: { status: 204 },
    [REMOVE]: { status: 204 },
    ...routes,
  });
}

const turnOn = () => screen.findByRole("button", { name: "Ativar avisos" });
const turnOff = () => screen.findByRole("button", { name: "Desligar avisos" });
const isOn = () => screen.findByText("Avisos ligados neste celular.");

/** Lets the card's first effects settle before checking it shows nothing. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the notifications card", () => {
  it("is not shown in a browser without Web Push, and asks the API nothing", async () => {
    const api = server();
    const { container } = render(<NotificationsCard />);
    await settle();
    expect(container.textContent).toBe("");
    expect(api.sent()).toEqual([]);
  });

  it("is not shown when the server has no key", async () => {
    fakePushBrowser();
    server({ [KEY]: { status: 503 } });
    const { container } = render(<NotificationsCard />);
    await settle();
    expect(container.textContent).toBe("");
  });

  it("turns notifications on: asks, subscribes and sends the subscription", async () => {
    const browser = fakePushBrowser();
    const api = server();
    render(<NotificationsCard />);

    await userEvent.click(await turnOn());

    expect(await isOn()).toBeTruthy();
    expect(browser.requestPermission).toHaveBeenCalledOnce();
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    });
    expect(
      api.sent(SAVE).map((r) => JSON.parse(r.body as string) as unknown),
    ).toEqual([browserSubscription]);
    expect(api.sent(SAVE)[0]!.headers.get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("explains how to unblock when the partner says no", async () => {
    fakePushBrowser({ answer: "denied" });
    const api = server();
    render(<NotificationsCard />);

    await userEvent.click(await turnOn());

    expect(await screen.findByText(/estão bloqueados/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ativar avisos" })).toBeNull();
    expect(api.sent(SAVE)).toEqual([]);
  });

  it("keeps the button when the partner closes the question", async () => {
    const browser = fakePushBrowser({ answer: "default" });
    const api = server();
    render(<NotificationsCard />);

    await userEvent.click(await turnOn());

    expect(await turnOn()).toBeTruthy();
    expect(browser.pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.sent(SAVE)).toEqual([]);
  });

  it("says so and keeps the button when the server does not store it", async () => {
    fakePushBrowser();
    server({ [SAVE]: { status: 500 } });
    render(<NotificationsCard />);

    await userEvent.click(await turnOn());

    expect(
      await screen.findByText("Não deu para ativar os avisos. Tente de novo."),
    ).toBeTruthy();
    expect(await turnOn()).toBeTruthy();
  });

  it("explains how to unblock when they were blocked before", async () => {
    fakePushBrowser({ permission: "denied" });
    server();
    render(<NotificationsCard />);

    expect(await screen.findByText(/estão bloqueados/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ativar avisos" })).toBeNull();
  });

  it("offers the button when allowed but not subscribed", async () => {
    fakePushBrowser({ permission: "granted" });
    const api = server();
    render(<NotificationsCard />);

    expect(await turnOn()).toBeTruthy();
    expect(api.sent(SAVE)).toEqual([]);
  });

  it("when already on, sends the subscription again, for this session", async () => {
    // After signing in again, the server knows this phone under the old
    // session; sending it moves it to this one.
    fakePushBrowser({ permission: "granted", subscribed: true });
    const api = server();
    render(<NotificationsCard />);

    expect(await isOn()).toBeTruthy();
    expect(api.sent(SAVE)).toHaveLength(1);
  });

  it("turns notifications off: the server first, then the browser", async () => {
    const browser = fakePushBrowser({
      permission: "granted",
      subscribed: true,
    });
    const api = server();
    render(<NotificationsCard />);

    await userEvent.click(await turnOff());

    expect(await turnOn()).toBeTruthy();
    expect(api.sent(REMOVE)).toHaveLength(1);
    expect(browser.subscribed).toBe(false);
  });

  it("stays on, and says so, when the server does not remove it", async () => {
    const browser = fakePushBrowser({
      permission: "granted",
      subscribed: true,
    });
    server({ [REMOVE]: { status: 500 } });
    render(<NotificationsCard />);

    await userEvent.click(await turnOff());

    expect(
      await screen.findByText(
        "Não deu para desligar os avisos. Tente de novo.",
      ),
    ).toBeTruthy();
    expect(await isOn()).toBeTruthy();
    expect(browser.subscribed).toBe(true);
  });
});

describe("keyBytes", () => {
  it("decodes base64url, with - and _", () => {
    expect([...keyBytes("-_8")]).toEqual([0xfb, 0xff]);
  });

  it("gives the 65 bytes of a P-256 key", () => {
    const bytes = keyBytes(publicKey);
    expect(bytes).toHaveLength(65);
    expect([...bytes.slice(0, 3)]).toEqual([4, 1, 2]);
  });
});
