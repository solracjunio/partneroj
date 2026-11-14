import { eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordExpense } from "./expenses.js";
import { acceptInvite, createInvite } from "./invites.js";
import { installJobQueue, startJobQueue } from "./jobs.js";
import { createPartnership } from "./partnerships.js";
import { addCategories, createProject } from "./projects.js";
import {
  deliveryTarget,
  entryNotice,
  forgetSubscription,
} from "./push-notices.js";
import { saveSubscription } from "./push-subscriptions.js";
import { reverseEntry } from "./reversals.js";
import { categories, pushSubscriptions, sessions } from "./schema.js";
import { findSession, SESSION_IDLE_DAYS } from "./sessions.js";
import {
  connectAsApp,
  startTestDatabase,
  type AppConnection,
  type TestDatabase,
} from "./testing.js";

let t: TestDatabase;
let app: AppConnection;
let boss: PgBoss;
beforeAll(async () => {
  t = await startTestDatabase();
  await installJobQueue(t.connectionString);
  app = await connectAsApp(t);
  boss = await startJobQueue(app.connectionString, { sendOnly: true });
});
afterAll(async () => {
  await boss?.stop({ graceful: false });
  await app?.db.$client.end();
  await t?.stop();
});

/** João and Maria (admins, weight 1 each) and Leo (reader), with "Material". */
async function seed(name = "Obra Teste") {
  const p = await createPartnership(app.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, maria, leo] = p.members.map((m) => m.id) as [
    string,
    string,
    string,
  ];
  const project = await createProject(app.db, {
    partnershipId: p.id,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: [
      { memberId: joao, weight: 1 },
      { memberId: maria, weight: 1 },
    ],
    actorId: null,
  });
  await addCategories(app.db, {
    partnershipId: p.id,
    names: ["Material"],
    actorId: null,
  });
  const [material] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id));
  return {
    partnershipId: p.id,
    projectId: project.id,
    materialId: material!.id,
    joao,
    maria,
    leo,
  };
}

type Seed = Awaited<ReturnType<typeof seed>>;

let counter = 0;
/** A new session of the member, subscribed; returns the subscription's id. */
async function subscribedPhone(memberId: string): Promise<{
  sessionId: string;
  subscriptionId: string;
  endpoint: string;
}> {
  const { token } = await createInvite(app.db, { memberId, createdBy: null });
  const accepted = await acceptInvite(app.db, token);
  const { sessionId } = (await findSession(app.db, accepted!.sessionToken))!;
  counter += 1;
  const endpoint = `https://fcm.googleapis.com/fcm/send/notice-${counter}`;
  await saveSubscription(app.db, {
    sessionId,
    endpoint,
    p256dh: "B".repeat(87),
    auth: "a".repeat(22),
  });
  const [row] = await app.db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.sessionId, sessionId));
  return { sessionId, subscriptionId: row!.id, endpoint };
}

/** João pays R$ 1.200,00 from his pocket. */
function spend(s: Seed, description: string | undefined = "cimento e areia") {
  return recordExpense(
    app.db,
    boss,
    { memberId: s.joao, partnershipId: s.partnershipId },
    {
      projectId: s.projectId,
      amount: 120000n,
      categoryId: s.materialId,
      occurredOn: "2027-01-12",
      description,
    },
  );
}

describe("entryNotice", () => {
  it("tells what was recorded, by whom, to the other members' phones", async () => {
    const s = await seed();
    await subscribedPhone(s.joao); // The author: never told.
    const maria = await subscribedPhone(s.maria);
    const leo = await subscribedPhone(s.leo); // Readers are told too.
    const entry = await spend(s);

    const notice = await entryNotice(app.db, entry.id);

    expect(notice).toEqual({
      entryId: entry.id,
      type: "expense",
      amount: 120000n,
      category: "Material",
      description: "cimento e areia",
      authorName: "João",
      reversalOf: null,
      reversalReason: null,
      createdAt: entry.createdAt,
      subscriptionIds: [maria.subscriptionId, leo.subscriptionId].sort(),
    });
  });

  it("tells about every phone of a member", async () => {
    const s = await seed();
    const phone = await subscribedPhone(s.maria);
    const tablet = await subscribedPhone(s.maria);
    const entry = await spend(s);

    const notice = await entryNotice(app.db, entry.id);

    expect(notice?.subscriptionIds).toEqual(
      [phone.subscriptionId, tablet.subscriptionId].sort(),
    );
  });

  it("leaves out revoked and idle sessions", async () => {
    const s = await seed();
    const revoked = await subscribedPhone(s.maria);
    const idle = await subscribedPhone(s.leo);
    await t.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, revoked.sessionId));
    await t.db
      .update(sessions)
      .set({
        lastUsedAt: sql`now() - make_interval(days => ${SESSION_IDLE_DAYS + 1})`,
      })
      .where(eq(sessions.id, idle.sessionId));
    const entry = await spend(s);

    expect((await entryNotice(app.db, entry.id))?.subscriptionIds).toEqual([]);
  });

  it("never tells another partnership", async () => {
    const s = await seed();
    const other = await seed("Outra Obra");
    await subscribedPhone(other.maria);
    const entry = await spend(s);

    expect((await entryNotice(app.db, entry.id))?.subscriptionIds).toEqual([]);
  });

  it("tells about an undo: the entry undone and the reason", async () => {
    const s = await seed();
    const entry = await spend(s);
    const reversal = await reverseEntry(
      app.db,
      boss,
      { memberId: s.joao, partnershipId: s.partnershipId },
      { entryId: entry.id, reason: "lancei duas vezes" },
    );

    expect(await entryNotice(app.db, reversal.id)).toMatchObject({
      entryId: reversal.id,
      amount: -120000n,
      category: "Material",
      reversalOf: entry.id,
      reversalReason: "lancei duas vezes",
    });
  });

  it("gives null for an entry that does not exist", async () => {
    expect(
      await entryNotice(app.db, "01a1c25b-7bf8-7cea-b37d-5194960ba97f"),
    ).toBeNull();
  });
});

describe("deliveryTarget", () => {
  it("gives where to send, while the session is live", async () => {
    const s = await seed();
    const phone = await subscribedPhone(s.maria);

    expect(await deliveryTarget(app.db, phone.subscriptionId)).toEqual({
      endpoint: phone.endpoint,
      p256dh: "B".repeat(87),
      auth: "a".repeat(22),
    });
  });

  it("gives null once the session is revoked: a lost phone gets nothing", async () => {
    const s = await seed();
    const phone = await subscribedPhone(s.maria);
    await t.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, phone.sessionId));

    expect(await deliveryTarget(app.db, phone.subscriptionId)).toBeNull();
  });

  it("gives null for a subscription removed since", async () => {
    expect(
      await deliveryTarget(app.db, "01a1c25b-7bf8-7cea-b37d-5194960ba97f"),
    ).toBeNull();
  });
});

describe("forgetSubscription", () => {
  it("removes a subscription the push service no longer knows", async () => {
    const s = await seed();
    const phone = await subscribedPhone(s.maria);

    await forgetSubscription(app.db, {
      id: phone.subscriptionId,
      endpoint: phone.endpoint,
    });

    expect(await deliveryTarget(app.db, phone.subscriptionId)).toBeNull();
  });

  it("keeps it when the phone renewed it since, with another endpoint", async () => {
    const s = await seed();
    const phone = await subscribedPhone(s.maria);
    const renewed = "https://fcm.googleapis.com/fcm/send/renewed";
    await saveSubscription(app.db, {
      sessionId: phone.sessionId,
      endpoint: renewed,
      p256dh: "B".repeat(87),
      auth: "a".repeat(22),
    });

    await forgetSubscription(app.db, {
      id: phone.subscriptionId,
      endpoint: phone.endpoint,
    });

    expect(await deliveryTarget(app.db, phone.subscriptionId)).toMatchObject({
      endpoint: renewed,
    });
  });
});
