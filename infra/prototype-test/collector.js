// Collects the guided test events sent by prototype/test.js.
// Only links with a known secret token are accepted, so a stranger who reads
// this public repository cannot fill the disk or forge answers.
import { Buffer } from "node:buffer";
import { appendFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import process from "node:process";

const DATA = process.env.DATA_DIR ?? "/data";
const MAX_BODY = 64 * 1024; // Caddy also cuts at 64 KB
const MAX_FILE = 20 * 1024 * 1024;
const MAX_EVENTS = 300; // per request
const MAX_EVENT = 2500; // characters of one event as JSON
const PER_MINUTE = 30; // requests per token

// TOKENS="label:secret,..." The label names the file; the secret is in the link.
const tokens = new Map(
  (process.env.TOKENS ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [label, secret] = pair.split(":");
      if (!/^[a-z0-9-]{1,20}$/.test(label) || (secret ?? "").length < 20) {
        throw new Error(`invalid TOKENS entry for label "${label}"`);
      }
      return [secret, label];
    }),
);
if (tokens.size === 0) throw new Error("TOKENS is empty");

const hits = new Map();
function allowed(label) {
  const minute = Math.floor(Date.now() / 60000);
  const hit = hits.get(label);
  if (!hit || hit.minute !== minute) {
    hits.set(label, { minute, count: 1 });
    return true;
  }
  hit.count += 1;
  return hit.count <= PER_MINUTE;
}

function clean(event) {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return null;
  }
  return JSON.stringify(event).length <= MAX_EVENT
    ? event
    : { type: "cortado", t: event.t };
}

createServer((req, res) => {
  const end = (status) => {
    res.writeHead(status);
    res.end();
  };
  if (req.method !== "POST" || req.url !== "/coleta") return end(404);

  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      end(413);
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on("end", () => {
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return end(400);
    }
    const label = tokens.get(payload?.token);
    if (!label) return end(403);
    if (!allowed(label)) return end(429);

    const file = join(DATA, `${label}.jsonl`);
    if (existsSync(file) && statSync(file).size > MAX_FILE) return end(507);
    const events = Array.isArray(payload.events)
      ? payload.events.slice(0, MAX_EVENTS).map(clean).filter(Boolean)
      : [];
    if (events.length === 0) return end(400);

    // One JSON object per line. JSON escapes newlines, so free text answers
    // cannot fake extra lines.
    const line = {
      recebido: new Date().toISOString(),
      sessao: String(payload.session ?? "")
        .replace(/[^0-9a-f-]/gi, "")
        .slice(0, 40),
      events,
    };
    appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    end(204);
  });
}).listen(3000, () =>
  process.stdout.write(`collector: ${tokens.size} token(s)\n`),
);
