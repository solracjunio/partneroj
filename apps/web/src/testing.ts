// Test helper for the screen tests: a fake API behind `fetch`, as the
// screens call it through api.ts. Never imported by the app itself.
import { afterEach, vi } from "vitest";

/**
 * Requests to routes no test listed. The screens catch a failed fetch as
 * "offline", so throwing inside fetch alone would pass unnoticed: the
 * test fails here instead, after it ran.
 */
let unexpected: string[] = [];
afterEach(() => {
  const hit = unexpected;
  unexpected = [];
  if (hit.length > 0) {
    throw new Error(
      `requests to routes the test didn't list: ${hit.join(", ")}`,
    );
  }
});

/** How the fake server answers a request: a status and body, or no answer. */
export type Answer =
  | { status: number; body?: unknown }
  | "offline"
  | Promise<{ status: number; body?: unknown } | "offline">;

/** A request as it went over the wire. */
export interface Sent {
  route: string;
  headers: Headers;
  body: unknown;
}

/**
 * Stubs `fetch` with a server that answers each route, "METHOD /api/path",
 * with its usual answer. `next` queues one-off answers for a route, taken
 * in order before the usual one: a failure, then success. Every request is
 * kept, so a test checks what the screen sent. A route not listed fails
 * the test after it runs, even when the screen shows it as "offline".
 *
 * Example: fakeServer({ "GET /api/me": { status: 200, body: me } }).
 */
export function fakeServer(routes: Record<string, Answer>) {
  const requests: Sent[] = [];
  const queued = new Map<string, Answer[]>();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const route = `${init.method ?? "GET"} ${url}`;
      requests.push({
        route,
        headers: new Headers(init.headers),
        body: init.body,
      });
      const answer = queued.get(route)?.shift() ?? routes[route];
      if (answer === undefined) {
        unexpected.push(route);
        throw new Error(`unexpected ${route}`);
      }
      const settled = await answer;
      if (settled === "offline") throw new TypeError("Failed to fetch");
      return new Response(
        settled.body === undefined ? null : JSON.stringify(settled.body),
        { status: settled.status },
      );
    }),
  );

  return {
    /** One-off answers for a route, before its usual one. */
    next(route: string, ...answers: Answer[]) {
      queued.set(route, [...(queued.get(route) ?? []), ...answers]);
    },
    /** The requests to a route, in order; every request without one. */
    sent(route?: string): Sent[] {
      return route === undefined
        ? requests
        : requests.filter((r) => r.route === route);
    },
  };
}

/** A promise the test settles when it wants: an answer still on its way. */
export function later<T>(): {
  promise: Promise<T>;
  settle: (value: T) => void;
} {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

/**
 * jsdom has no matchMedia, which the install card asks whether the app
 * runs from its icon ("display-mode: standalone"). Unstubbed with the rest.
 */
export function stubDisplayMode({ standalone }: { standalone: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
  }));
}

/** The subscription the fake browser hands out, as toJSON() gives it. */
export const browserSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/web-test",
  expirationTime: null,
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
};

/**
 * jsdom has no Web Push: no Notification, no PushManager and no service
 * worker, which is what an unsupported browser looks like. This stubs a
 * browser that has them. `permission` is the current one; `answer` is
 * what the partner taps when asked. Unstubbed with the rest.
 */
export function fakePushBrowser({
  permission = "default",
  answer = "granted",
  subscribed = false,
}: {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  subscribed?: boolean;
} = {}) {
  let current = permission;
  const subscription = {
    endpoint: browserSubscription.endpoint,
    toJSON: () => browserSubscription,
    unsubscribe: vi.fn(() => {
      held = null;
      return Promise.resolve(true);
    }),
  };
  let held: typeof subscription | null = subscribed ? subscription : null;
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(held)),
    // Typed with the options, so a test can check what was asked for.
    subscribe: vi.fn<
      (options: PushSubscriptionOptionsInit) => Promise<typeof subscription>
    >(() => {
      held = subscription;
      return Promise.resolve(subscription);
    }),
  };
  const registration = { pushManager };
  const requestPermission = vi.fn(() => {
    current = answer;
    return Promise.resolve(answer);
  });

  vi.stubGlobal("Notification", {
    get permission() {
      return current;
    },
    requestPermission,
  });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("navigator", {
    ...navigator,
    serviceWorker: {
      getRegistration: () => Promise.resolve(registration),
      ready: Promise.resolve(registration),
    },
  });

  return {
    requestPermission,
    pushManager,
    subscription,
    /** Whether the browser holds a subscription now. */
    get subscribed() {
      return held !== null;
    },
  };
}
