import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acceptInvite, createInvite } from "./invites.js";
import { removeSubscription, saveSubscription } from "./push-subscriptions.js";
import { members, partnerships, pushSubscriptions } from "./schema.js";
import { findSession } from "./sessions.js";
import {
  connectAsApp,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

let t: TestDatabase;
let app: AppConnection;
beforeAll(async () => {
  t = await startTestDatabase();
  app = await connectAsApp(t);
});
afterAll(async () => {
  await app?.db.$client.end();
  await t?.stop();
});

/** A new session of a member (a new member when none is given). */
async function newSession(
  memberId?: string,
): Promise<{ sessionId: string; memberId: string }> {
  if (memberId === undefined) {
    const [p] = await t.db
      .insert(partnerships)
      .values({ name: "Obra Teste" })
      .returning();
    const [member] = await t.db
      .insert(members)
      .values({ partnershipId: p!.id, name: "João", role: "admin" })
      .returning();
    memberId = member!.id;
  }
  const { token } = await createInvite(app.db, { memberId, createdBy: null });
  const accepted = await acceptInvite(app.db, token);
  const session = await findSession(app.db, accepted!.sessionToken);
  return { sessionId: session!.sessionId, memberId };
}

let counter = 0;
/** A subscription with an endpoint no other test uses. */
function subscription(keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) }) {
  counter += 1;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${counter}`,
    ...keys,
  };
}

const rowsOf = (sessionId: string) =>
  app.db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.sessionId, sessionId));

const rowsAt = (endpoint: string) =>
  app.db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));

describe("saveSubscription", () => {
  it("stores the subscription of the session", async () => {
    const { sessionId } = await newSession();
    const sub = subscription();

    await saveSubscription(app.db, { sessionId, ...sub });

    expect(await rowsOf(sessionId)).toEqual([
      expect.objectContaining({ sessionId, ...sub }),
    ]);
  });

  it("keeps one subscription per session: a new one replaces the old", async () => {
    const { sessionId } = await newSession();
    await saveSubscription(app.db, { sessionId, ...subscription() });
    const renewed = subscription({
      p256dh: "C".repeat(87),
      auth: "b".repeat(22),
    });

    await saveSubscription(app.db, { sessionId, ...renewed });

    expect(await rowsOf(sessionId)).toEqual([
      expect.objectContaining({ sessionId, ...renewed }),
    ]);
  });

  it("moves an endpoint to the session that sends it last", async () => {
    // The same browser, signed in again: the old session must not keep
    // getting this phone's notifications.
    const { sessionId: old, memberId } = await newSession();
    const sub = subscription();
    await saveSubscription(app.db, { sessionId: old, ...sub });

    const { sessionId: current } = await newSession(memberId);
    await saveSubscription(app.db, { sessionId: current, ...sub });

    expect(await rowsAt(sub.endpoint)).toEqual([
      expect.objectContaining({ sessionId: current }),
    ]);
    expect(await rowsOf(old)).toEqual([]);
  });

  it("saving the same subscription again changes nothing", async () => {
    const { sessionId } = await newSession();
    const sub = subscription();
    await saveSubscription(app.db, { sessionId, ...sub });

    await saveSubscription(app.db, { sessionId, ...sub });

    expect(await rowsOf(sessionId)).toHaveLength(1);
  });
});

describe("removeSubscription", () => {
  it("removes the session's subscription and no other", async () => {
    // Two phones of the same member: each session has its own.
    const { sessionId: mine, memberId } = await newSession();
    const { sessionId: other } = await newSession(memberId);
    await saveSubscription(app.db, { sessionId: mine, ...subscription() });
    await saveSubscription(app.db, { sessionId: other, ...subscription() });

    await removeSubscription(app.db, mine);

    expect(await rowsOf(mine)).toEqual([]);
    expect(await rowsOf(other)).toHaveLength(1);
  });

  it("does nothing when the session has no subscription", async () => {
    const { sessionId } = await newSession();
    await expect(
      removeSubscription(app.db, sessionId),
    ).resolves.toBeUndefined();
  });
});
