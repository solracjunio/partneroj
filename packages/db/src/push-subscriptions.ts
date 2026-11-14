// Web Push subscriptions (plan section 4). A phone subscribes from the app
// and the worker sends to it. Each session holds at most one, so the table
// never grows past the number of sessions.
import { and, eq, ne } from "drizzle-orm";
import type { Database } from "./client.js";
import { pushSubscriptions } from "./schema.js";

export interface NewSubscription {
  sessionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Stores the session's subscription, replacing the one it had. An
 * endpoint held by another session moves here: it is the same browser,
 * signed in again, and the old session must not keep its notifications.
 */
export async function saveSubscription(
  db: Database,
  sub: NewSubscription,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, sub.endpoint),
          ne(pushSubscriptions.sessionId, sub.sessionId),
        ),
      );
    await tx
      .insert(pushSubscriptions)
      .values(sub)
      .onConflictDoUpdate({
        target: pushSubscriptions.sessionId,
        set: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      });
  });
}

/** Removes the session's subscription, if any ("Desligar avisos"). */
export async function removeSubscription(
  db: Database,
  sessionId: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.sessionId, sessionId));
}
