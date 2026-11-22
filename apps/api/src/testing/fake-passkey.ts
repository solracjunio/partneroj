// Test helper: a phone's passkey, without a phone. It answers
// navigator.credentials.create() as an authenticator does (WebAuthn,
// section 6.5), with a real P-256 key, so the API's tests check the real
// signature, RP ID and origin, not a stand-in. Left out of the build.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

import type { PasskeyRegistration } from "@partneroj/contracts";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

/** Authenticator data flags (WebAuthn, section 6.1). */
const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const ATTESTED_CREDENTIAL = 0x40;

/** COSE key labels and values for an ES256 key (RFC 9053). */
const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;
const KTY_EC2 = 2;
const ALG_ES256 = -7;
const CRV_P256 = 1;

/** How the answer is made; each field defaults to what a phone does. */
export interface Answer {
  /** The site the phone thinks it is on. */
  rpID: string;
  origin: string;
  /** False as when the phone took a tap instead of the fingerprint. */
  userVerified?: boolean;
  /** A challenge other than the one in the options. */
  challenge?: string;
  /** 0 by default, as synced passkeys send; security keys count up. */
  counter?: number;
  /** ["internal", "hybrid"] by default; null leaves them out. */
  transports?: string[] | null;
}

/** What isoCBOR encodes: numbers, strings, bytes, arrays and maps. */
type Cbor = Parameters<typeof isoCBOR.encode>[0];

const sha256 = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest();

export class FakePasskey {
  /** Like a phone's, random; pass one to make a second phone with the same id. */
  readonly credentialId: string;
  private readonly keys = generateKeyPairSync("ec", { namedCurve: "P-256" });

  constructor(credentialId = isoBase64URL.fromBuffer(randomBytes(16))) {
    this.credentialId = credentialId;
  }

  /** The answer to navigator.credentials.create(options), as JSON. */
  register(
    options: { challenge: string },
    answer: Answer,
  ): PasskeyRegistration {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.create",
        challenge: answer.challenge ?? options.challenge,
        origin: answer.origin,
        crossOrigin: false,
      }),
    );
    const flags =
      USER_PRESENT |
      ATTESTED_CREDENTIAL |
      (answer.userVerified === false ? 0 : USER_VERIFIED);
    const authData = Buffer.concat([
      sha256(answer.rpID),
      Buffer.from([flags]),
      this.counter(answer.counter ?? 0),
      Buffer.alloc(16), // AAGUID: none, as with attestation "none"
      this.credentialIdLength(),
      isoBase64URL.toBuffer(this.credentialId),
      this.cosePublicKey(),
    ]);
    // Attestation "none": the authenticator vouches for nothing, and the
    // API asks for nothing (attestationType: "none").
    const attestationObject = isoCBOR.encode(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map<string, Cbor>()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.credentialId,
      rawId: this.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        ...(answer.transports === null
          ? {}
          : { transports: answer.transports ?? ["internal", "hybrid"] }),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** The COSE public key, base64url, as the API should save it. */
  get publicKey(): string {
    return isoBase64URL.fromBuffer(this.cosePublicKey());
  }

  private counter(value: number): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(value);
    return counter;
  }

  private credentialIdLength(): Buffer {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(isoBase64URL.toBuffer(this.credentialId).length);
    return length;
  }

  private cosePublicKey(): ReturnType<typeof isoCBOR.encode> {
    const jwk = this.keys.publicKey.export({ format: "jwk" });
    return isoCBOR.encode(
      new Map<number, Cbor>([
        [COSE_KTY, KTY_EC2],
        [COSE_ALG, ALG_ES256],
        [COSE_CRV, CRV_P256],
        [COSE_X, isoBase64URL.toBuffer(jwk.x!)],
        [COSE_Y, isoBase64URL.toBuffer(jwk.y!)],
      ]),
    );
  }
}
