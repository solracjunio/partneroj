// VAPID (RFC 8292) with node:crypto only: key pair on P-256 and an ES256 JWT.
// Smoke test only. The real push (block 5) also encrypts a payload (RFC 8291).
import { Buffer } from "node:buffer";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Loads the key pair from `file`, creating it on first run. */
export function loadOrCreateKeys(file) {
  if (!existsSync(file)) {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    writeFileSync(file, JSON.stringify(privateKey.export({ format: "jwk" })), {
      mode: 0o600,
    });
  }
  const jwk = JSON.parse(readFileSync(file, "utf8"));
  return {
    privateKey: createPrivateKey({ key: jwk, format: "jwk" }),
    // Browsers want the raw uncompressed point: 0x04 || x || y.
    publicKey: b64url(
      Buffer.concat([
        Buffer.from([4]),
        Buffer.from(jwk.x, "base64url"),
        Buffer.from(jwk.y, "base64url"),
      ]),
    ),
  };
}

/** Builds the `Authorization` header value for a push service endpoint. */
export function vapidAuthorization(endpoint, keys, subject) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: subject,
    }),
  );
  const data = `${header}.${claims}`;
  // JWT needs the raw 64-byte r||s signature, not the default DER encoding.
  const signature = sign("sha256", Buffer.from(data), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${data}.${b64url(signature)}, k=${keys.publicKey}`;
}
