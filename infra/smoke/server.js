// Smoke test server: serves the test page and stores push subscriptions.
// There is no public "send" route on purpose: pushes are sent by send.js
// from inside the server, so nobody else can notify the test phones.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { loadOrCreateKeys } from "./vapid.js";

const DATA = process.env.DATA_DIR ?? "/data";
const SUBS = join(DATA, "subscriptions.json");
const PUBLIC = new URL("./public/", import.meta.url);
const keys = loadOrCreateKeys(join(DATA, "vapid.json"));

const pages = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
};

const readSubs = () =>
  existsSync(SUBS) ? JSON.parse(readFileSync(SUBS, "utf8")) : [];

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

createServer((req, res) => {
  const send = (status, type, body) => {
    res.writeHead(status, { "Content-Type": type });
    res.end(body);
  };

  if (req.method === "GET" && req.url in pages) {
    const [file, type] = pages[req.url];
    return send(200, type, readFileSync(new URL(file, PUBLIC)));
  }
  if (req.method === "GET" && req.url === "/vapid-public-key") {
    return send(200, "text/plain", keys.publicKey);
  }
  if (req.method === "POST" && req.url === "/subscribe") {
    return readBody(req)
      .then((raw) => {
        const { name, subscription } = JSON.parse(raw);
        if (
          typeof subscription?.endpoint !== "string" ||
          !subscription.endpoint.startsWith("https://")
        ) {
          return send(400, "text/plain", "invalid subscription");
        }
        const label = String(name ?? "?").slice(0, 40);
        const subs = readSubs().filter(
          (s) => s.subscription.endpoint !== subscription.endpoint,
        );
        subs.push({ name: label, subscription, at: new Date().toISOString() });
        writeFileSync(SUBS, JSON.stringify(subs, null, 2), { mode: 0o600 });
        process.stdout.write(
          `subscribed: ${label} (${new URL(subscription.endpoint).host})\n`,
        );
        send(201, "text/plain", "ok");
      })
      .catch(() => send(400, "text/plain", "bad request"));
  }
  send(404, "text/plain", "not found");
}).listen(3000, () => process.stdout.write("smoke push server on :3000\n"));
