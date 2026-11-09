// Prints a VAPID key pair (RFC 8292) as .env lines, in the format the
// web-push libraries use: the public key is the uncompressed P-256 point
// (65 bytes), the private key its 32-byte scalar, both base64url.
// Run once, on the server, appending to .env (docs/operacao.md):
//   docker run --rm -v "$PWD/infra/production:/s:ro" node:26-alpine \
//     node /s/generate-vapid-keys.mjs >> infra/production/.env
// Never run it again for the same deploy: every push subscription is tied
// to the public key, so new keys silently break all of them.
import { generateKeyPairSync } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const publicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, "base64url"),
  Buffer.from(jwk.y, "base64url"),
]).toString("base64url");

process.stdout.write(
  `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${jwk.d}\n`,
);
