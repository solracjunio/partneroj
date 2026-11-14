// Web Push on this phone (plan section 4): whether it can work here, and
// turning it on and off. The service worker (sw/sw.ts) shows what comes.
import { api } from "./api";

/**
 * - "unsupported": no Web Push in this browser, or no service worker yet.
 * - "blocked": the partner said no; only the browser's settings undo it.
 * - "off": can be turned on (the browser may still ask).
 * - "on": allowed, and this browser holds a subscription.
 */
export type PushState = "unsupported" | "blocked" | "off" | "on";

export function decidePushState(facts: {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
}): PushState {
  if (!facts.supported) return "unsupported";
  if (facts.permission === "denied") return "blocked";
  if (facts.permission === "granted" && facts.subscribed) return "on";
  return "off";
}

/**
 * The service worker's registration, or null when push cannot work here.
 * getRegistration, not `ready`: `ready` never settles without a service
 * worker (as in `vite` development), and the card would wait forever.
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (
    !("serviceWorker" in navigator) ||
    typeof PushManager === "undefined" ||
    typeof Notification === "undefined"
  ) {
    return null;
  }
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** The state here, and the subscription when there is one. */
export async function readPush(): Promise<{
  state: PushState;
  subscription: PushSubscription | null;
}> {
  const reg = await registration();
  const subscription = (await reg?.pushManager.getSubscription()) ?? null;
  const state = decidePushState({
    supported: reg !== null,
    permission: reg === null ? "default" : Notification.permission,
    subscribed: subscription !== null,
  });
  return { state, subscription };
}

/** base64url (the VAPID key as the API sends it) to bytes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * "Ativar avisos". Must run from the tap itself: Chrome refuses to ask for
 * the permission otherwise. "failed" leaves the browser's subscription in
 * place; the next tap gets the same one and sends it again.
 */
export async function turnOnPush(
  publicKey: string,
): Promise<"on" | "off" | "blocked" | "failed"> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  // "default": the partner closed the question without answering.
  if (permission !== "granted") return "off";

  let subscription: PushSubscription;
  try {
    const reg = await navigator.serviceWorker.ready;
    subscription = await reg.pushManager.subscribe({
      // Every push shows a notification (sw.ts): Chrome requires it.
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    });
  } catch {
    return "failed";
  }
  const saved = await api.saveSubscription(subscription.toJSON());
  return saved.ok ? "on" : "failed";
}

/**
 * "Desligar avisos": the server first, so it stops sending; only then the
 * browser. Done the other way, a failed call would leave the server
 * sending to a subscription this phone no longer shows as on.
 */
export async function turnOffPush(): Promise<"off" | "failed"> {
  const removed = await api.removeSubscription();
  if (!removed.ok) return "failed";
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  return "off";
}

/**
 * The browser's name as Android's app list shows it, on Android only;
 * null elsewhere. Android's default battery setting ("Otimizada") can
 * hold a push back for minutes even with Urgency high: the browser has
 * to be "Sem restrições" (seen on 2026-11-14, 6 minutes against 1 s).
 * Brave sends Chrome's user agent, and has navigator.brave.
 */
export function androidBrowser(): string | null {
  const ua = navigator.userAgent;
  if (!/Android/.test(ua)) return null;
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/EdgA/.test(ua)) return "Edge";
  if ("brave" in navigator) return "Brave";
  if (/Chrome/.test(ua)) return "Chrome";
  return "o navegador";
}
