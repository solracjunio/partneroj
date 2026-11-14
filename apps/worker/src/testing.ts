// Test helper for the worker's tests: a migrated Postgres with pg-boss,
// connected as the app, and a partnership whose members have phones.
// Never imported by the worker itself.
import {
  acceptInvite,
  addCategories,
  categories,
  createInvite,
  createPartnership,
  createProject,
  findSession,
  installJobQueue,
  type PgBoss,
  pushSubscriptions,
  recordExpense,
  saveSubscription,
  startJobQueue,
} from "@partneroj/db";
import {
  type AppConnection,
  connectAsApp,
  startTestDatabase,
  type TestDatabase,
} from "@partneroj/db/testing";
import { eq } from "drizzle-orm";

export interface WorkerTest {
  t: TestDatabase;
  app: AppConnection;
  boss: PgBoss;
  stop(): Promise<void>;
}

/** As in production: the owner installs pg-boss, the app works it. */
export async function startWorkerTest(): Promise<WorkerTest> {
  const t = await startTestDatabase();
  await installJobQueue(t.connectionString);
  const app = await connectAsApp(t);
  const boss = await startJobQueue(app.connectionString, { sendOnly: true });
  return {
    t,
    app,
    boss,
    async stop() {
      await boss.stop({ graceful: false });
      await app.db.$client.end();
      await t.stop();
    },
  };
}

/** João and Maria (admins) and Leo (reader), in a project with "Material". */
export async function seed(w: WorkerTest, name = "Obra Teste") {
  const p = await createPartnership(w.app.db, {
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
  const project = await createProject(w.app.db, {
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
  await addCategories(w.app.db, {
    partnershipId: p.id,
    names: ["Material"],
    actorId: null,
  });
  const [material] = await w.t.db
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

export type Seed = Awaited<ReturnType<typeof seed>>;

let counter = 0;

/** A new session of the member with a subscription, as the app makes it. */
export async function subscribedPhone(
  w: WorkerTest,
  memberId: string,
): Promise<{ sessionId: string; subscriptionId: string; endpoint: string }> {
  const { token } = await createInvite(w.app.db, { memberId, createdBy: null });
  const accepted = await acceptInvite(w.app.db, token);
  const { sessionId } = (await findSession(w.app.db, accepted!.sessionToken))!;
  counter += 1;
  const endpoint = `https://fcm.googleapis.com/fcm/send/worker-${counter}`;
  await saveSubscription(w.app.db, {
    sessionId,
    endpoint,
    p256dh: "B".repeat(87),
    auth: "a".repeat(22),
  });
  const [row] = await w.app.db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.sessionId, sessionId));
  return { sessionId, subscriptionId: row!.id, endpoint };
}

/** João pays R$ 1.200,00 from his pocket. */
export function spend(w: WorkerTest, s: Seed) {
  return recordExpense(
    w.app.db,
    w.boss,
    { memberId: s.joao, partnershipId: s.partnershipId },
    {
      projectId: s.projectId,
      amount: 120000n,
      categoryId: s.materialId,
      occurredOn: "2027-01-12",
      description: "cimento e areia",
    },
  );
}
