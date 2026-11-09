// Installing the app (plan section 5). Chrome and Samsung Internet on
// Android fire `beforeinstallprompt` when the app can be installed; the
// event is kept so our own button can show the browser's install dialog.
// It may fire before React renders anything, so listenForInstall() runs
// at startup, in main.tsx.
import { useSyncExternalStore } from "react";

/** Chrome's event; not in the DOM types, since it is not a standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * - "in-app": already running from the installed icon.
 * - "installed": just installed from this page.
 * - "can-prompt": the browser offers installing; our button can ask.
 * - "manual": no offer (yet); the page explains the browser's menu.
 */
export type InstallState = "in-app" | "installed" | "can-prompt" | "manual";

export function decideInstallState(facts: {
  standalone: boolean;
  installed: boolean;
  canPrompt: boolean;
}): InstallState {
  if (facts.standalone) return "in-app";
  if (facts.installed) return "installed";
  if (facts.canPrompt) return "can-prompt";
  return "manual";
}

let offer: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function listenForInstall(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Our button replaces the browser's own banner.
    event.preventDefault();
    offer = event as BeforeInstallPromptEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    offer = null;
    changed();
  });
}

function currentState(): InstallState {
  return decideInstallState({
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    installed,
    canPrompt: offer !== null,
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The install state, re-rendering the component when it changes. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, currentState);
}

/** Shows the browser's install dialog. An offer can be used only once. */
export async function askToInstall(): Promise<void> {
  const current = offer;
  if (current === null) return;
  offer = null;
  await current.prompt();
  // "appinstalled" reports success; a "no" leaves the menu instructions.
  await current.userChoice;
  changed();
}
