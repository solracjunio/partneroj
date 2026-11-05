/* global fetch */
// Sends an empty push to every stored subscription, or only to names given
// as arguments. Run inside the container:
//   docker compose exec push node send.js [name...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { loadOrCreateKeys, vapidAuthorization } from "./vapid.js";

const DATA = process.env.DATA_DIR ?? "/data";
const SUBS = join(DATA, "subscriptions.json");
const SUBJECT = "https://partneroj.com.br";
const keys = loadOrCreateKeys(join(DATA, "vapid.json"));
const only = process.argv.slice(2);

const subs = existsSync(SUBS) ? JSON.parse(readFileSync(SUBS, "utf8")) : [];
const targets = subs.filter((s) => only.length === 0 || only.includes(s.name));
if (targets.length === 0) {
  process.stdout.write("no subscriptions to send to\n");
  process.exit(1);
}

const gone = new Set();
for (const { name, subscription } of targets) {
  const started = Date.now();
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, keys, SUBJECT),
      TTL: "60",
      Urgency: "high",
      "Content-Length": "0",
    },
  });
  process.stdout.write(
    `${name}: HTTP ${res.status} in ${Date.now() - started} ms\n`,
  );
  // 404/410: the browser dropped this subscription, so forget it.
  if (res.status === 404 || res.status === 410) gone.add(subscription.endpoint);
  else if (!res.ok) process.stdout.write(`  ${await res.text()}\n`);
}

if (gone.size > 0) {
  const kept = subs.filter((s) => !gone.has(s.subscription.endpoint));
  writeFileSync(SUBS, JSON.stringify(kept, null, 2), { mode: 0o600 });
  process.stdout.write(`removed ${gone.size} expired subscription(s)\n`);
}
