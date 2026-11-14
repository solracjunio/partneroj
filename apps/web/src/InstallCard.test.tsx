// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubDisplayMode } from "./testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The card with a fresh install.ts: the browser's offer lives in that
 * module, so each test starts with none, listening as main.tsx does.
 */
async function freshCard({ standalone = false } = {}) {
  stubDisplayMode({ standalone });
  vi.resetModules();
  const install = await import("./install");
  install.listenForInstall();
  const { InstallCard } = await import("./InstallCard");
  render(<InstallCard />);
}

/** Chrome's beforeinstallprompt, with the answer the partner gives. */
function offer(outcome: "accepted" | "dismissed") {
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome }),
    },
  );
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const menuText = /No menu do navegador/;

describe("the install card", () => {
  it("is not shown when the app already runs from its icon", async () => {
    await freshCard({ standalone: true });
    expect(screen.queryByText(/Instale o app/)).toBeNull();
  });

  it("explains the browser's menu when there is no offer", async () => {
    await freshCard();
    expect(screen.getByText(menuText)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Instalar o app" })).toBeNull();
  });

  it("asks with the browser's dialog when the browser offers it", async () => {
    await freshCard();
    const event = offer("dismissed");
    // Our button replaces the browser's own banner.
    expect(event.defaultPrevented).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Instalar o app" }));
    expect(event.prompt).toHaveBeenCalledOnce();
    // An offer is used once: after a "no", the menu instructions are left.
    expect(await screen.findByText(menuText)).toBeTruthy();
  });

  it("says it is installed once the browser reports it", async () => {
    await freshCard();
    offer("accepted");
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(screen.getByText("Pronto, o app está instalado.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Instalar o app" })).toBeNull();
  });
});
