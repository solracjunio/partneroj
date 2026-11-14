// What the service worker shows for a push, and where a tap on it leads
// (plan section 4). Plain functions, so they are tested without a worker.
import type { PushMessage } from "@partneroj/contracts";

const ICON = "/pwa-192x192.png";
const FEED = "/atividades";

export interface ShownNotification {
  title: string;
  options: {
    body: string;
    tag?: string;
    icon: string;
    data: { url: string };
  };
}

function isMessage(value: unknown): value is PushMessage {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m["title"] === "string" &&
    typeof m["body"] === "string" &&
    typeof m["tag"] === "string" &&
    typeof m["url"] === "string"
  );
}

/**
 * The notification for a push's text. Chrome requires one for every push
 * (a silent push costs the site its permission), so a payload that is
 * missing or unreadable still shows a fixed text, and the feed, the
 * source of truth, holds the details.
 */
export function notificationFrom(text: string | null): ShownNotification {
  let parsed: unknown = null;
  try {
    parsed = text === null ? null : JSON.parse(text);
  } catch {
    // Not JSON: the fixed text below.
  }
  if (!isMessage(parsed)) {
    return {
      title: "Partneroj",
      options: {
        body: "Nova movimentação. Toque para ver.",
        icon: ICON,
        data: { url: FEED },
      },
    };
  }
  return {
    title: parsed.title,
    options: {
      body: parsed.body,
      // The event's id: the same push sent twice replaces the first while
      // it is still in the tray, instead of showing two.
      tag: parsed.tag,
      icon: ICON,
      data: { url: parsed.url },
    },
  };
}

/**
 * The page a tap opens: a path of this site only, never another address,
 * even if a push carried one. "//host" and "/\host" are other sites to a
 * browser, so the path must start with "/" followed by neither.
 */
export function clickTarget(data: unknown): string {
  const url =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)["url"]
      : undefined;
  if (typeof url === "string" && /^\/(?![/\\])/.test(url)) return url;
  return FEED;
}
