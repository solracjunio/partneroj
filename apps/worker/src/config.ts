// The worker's settings, from the environment (infra/production/compose.yml).
import type { Vapid } from "./web-push-sender.js";

export interface WorkerConfig {
  databaseUrl: string;
  vapid: Vapid;
}

const NAMES = [
  "DATABASE_URL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

/**
 * Reads the settings, or throws naming every one missing: the worker
 * must not start without its keys and then fail on each push. The
 * message never shows a value (the private key is one).
 */
export function readConfig(
  env: Record<string, string | undefined>,
): WorkerConfig {
  const missing = NAMES.filter((name) => (env[name] ?? "") === "");
  if (missing.length > 0) {
    throw new Error(`missing environment variables: ${missing.join(", ")}`);
  }
  const get = (name: (typeof NAMES)[number]) => env[name]!;
  return {
    databaseUrl: get("DATABASE_URL"),
    vapid: {
      subject: get("VAPID_SUBJECT"),
      publicKey: get("VAPID_PUBLIC_KEY"),
      privateKey: get("VAPID_PRIVATE_KEY"),
    },
  };
}
