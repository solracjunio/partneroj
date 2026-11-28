// Jobs on pg-boss, in the same Postgres as the data (plan section 4).
// The queue lives next to the entries, so an entry and the job that
// announces it are written in one transaction: both or neither.
import { sql } from "drizzle-orm";
import pg from "pg";
import { fromDrizzle, PgBoss } from "pg-boss";
import type { Database } from "./client.js";

export const queues = {
  /**
   * A new entry: one job per entry, in the entry's transaction. The worker
   * turns it into one push-delivery per phone to tell.
   */
  entryNotification: "entry-notification",
  emergencyNotification: "emergency-notification",
  /**
   * One push to one phone. Apart from the entry's job, so a failure is
   * retried for that phone alone, and the others are not told twice.
   */
  pushDelivery: "push-delivery",
  /**
   * Once a day, at CHALLENGE_CLEANUP_CRON: deleteStaleChallenges. Asking
   * for a sign-in challenge needs no session, so its rows are cleared on
   * a schedule, not by whoever made them.
   */
  challengeCleanup: "challenge-cleanup",
} as const;

/** 06:30 UTC, 03:30 in Brasília: when nobody is recording expenses. */
export const CHALLENGE_CLEANUP_CRON = "30 6 * * *";

type QueueName = (typeof queues)[keyof typeof queues];

/**
 * Retries with exponential backoff (pg-boss: about retryDelay * 2^n,
 * with jitter, capped at retryDelayMax). A fan-out only reads and writes
 * this database, so it gives up in about a minute. A push may wait out a
 * push service's outage: up to an hour or so, and never past the
 * notice's deadline, which the worker checks (24 h, plan section 4).
 * expireInSeconds: a send takes seconds; one stuck longer is retried.
 */
const fanOutOptions = {
  retryLimit: 5,
  retryDelay: 1,
  retryBackoff: true,
  retryDelayMax: 30,
  expireInSeconds: 60,
};

export const queueOptions: Record<
  QueueName,
  {
    retryLimit: number;
    retryDelay: number;
    retryBackoff: boolean;
    retryDelayMax: number;
    expireInSeconds: number;
  }
> = {
  [queues.entryNotification]: fanOutOptions,
  [queues.emergencyNotification]: fanOutOptions,
  [queues.pushDelivery]: {
    retryLimit: 10,
    retryDelay: 2,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 60,
  },
  // A missed day is no harm: the next one removes those rows too.
  [queues.challengeCleanup]: {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 60,
  },
};

export interface EntryNotification {
  entryId: string;
}

export interface EmergencyNotification {
  activityId: string;
}

export interface PushDelivery {
  subscriptionId: string;
  /** The PushMessage, as JSON: what the phone shows. */
  payload: string;
  /** ISO time after which the push is dropped instead of sent. */
  deadline: string;
}

/**
 * Creates each queue, or gives one that exists its current options:
 * createQueue leaves an existing queue as it was, so a queue created by
 * an older deploy would keep pg-boss's defaults without updateQueue.
 */
async function setUpQueues(boss: PgBoss): Promise<void> {
  for (const name of Object.values(queues)) {
    await boss.createQueue(name, queueOptions[name]);
    await boss.updateQueue(name, queueOptions[name]);
  }
}

/** The `tx` that db.transaction() hands to its callback. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Installs pg-boss and hands its schema to the app role (migration 0006).
 * Run it as the owner, right after runMigrations(), at each deploy.
 *
 * pg-boss's install runs CREATE SCHEMA, which needs CREATE on the whole
 * database; the app role must not have that (it could then shadow the
 * owner's tables through search_path). At run time pg-boss also creates
 * tables (a stats partition per day), so the app must own what is in
 * pgboss. Hence: the owner installs, then gives everything in it away.
 */
export async function installJobQueue(connectionString: string): Promise<void> {
  const boss = new PgBoss({
    connectionString,
    supervise: false,
    schedule: false,
  });
  boss.on("error", (error) => console.error("pg-boss", error));
  await boss.start();
  await setUpQueues(boss);
  await boss.stop({ graceful: false });

  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    await db.query(giveJobSchemaToApp);
  } finally {
    await db.end();
  }
}

// Indexes follow their table. pg-boss uses no sequences (uuid ids).
// Already done on later deploys: changing an owner to itself is a no-op.
const giveJobSchemaToApp = `
DO $$
DECLARE
  r record;
BEGIN
  ALTER SCHEMA pgboss OWNER TO partneroj_app;
  FOR r IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss' AND c.relkind IN ('r', 'p', 'v')
  LOOP
    EXECUTE format('ALTER TABLE pgboss.%I OWNER TO partneroj_app', r.relname);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS routine FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pgboss'
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO partneroj_app', r.routine);
  END LOOP;
  -- Enums and the like; a table's own row type follows the table.
  FOR r IN
    SELECT t.typname FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pgboss' AND t.typrelid = 0 AND t.typelem = 0
  LOOP
    EXECUTE format('ALTER TYPE pgboss.%I OWNER TO partneroj_app', r.typname);
  END LOOP;
END
$$`;

/**
 * Starts pg-boss and its queues. As the app, call installJobQueue() first
 * (at deploy, as the owner); as the owner, as in most tests, it installs.
 *
 * sendOnly is for the API, which only queues jobs: the worker alone runs
 * pg-boss's maintenance and schedules, so they don't run twice.
 */
export async function startJobQueue(
  connectionString: string,
  options: { sendOnly?: boolean } = {},
): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    ...(options.sendOnly ? { supervise: false, schedule: false } : {}),
  });
  // An EventEmitter without an "error" listener crashes the process.
  boss.on("error", (error) => console.error("pg-boss", error));
  await boss.start();
  await setUpQueues(boss);
  return boss;
}

/**
 * Queues the notification of an entry inside the caller's transaction: if
 * the transaction rolls back, the job is gone too, so no partner is told
 * about an entry that was never recorded.
 */
export async function queueEntryNotification(
  boss: PgBoss,
  tx: Transaction,
  entryId: string,
): Promise<void> {
  const data: EntryNotification = { entryId };
  await boss.send(queues.entryNotification, data, { db: fromDrizzle(tx, sql) });
}

export async function queueEmergencyNotification(
  boss: PgBoss,
  tx: Transaction,
  activityId: string,
): Promise<void> {
  const data: EmergencyNotification = { activityId };
  const id = await boss.send(queues.emergencyNotification, data, {
    db: fromDrizzle(tx, sql),
  });
  if (id === null) throw new Error("emergency notification was not queued");
}
