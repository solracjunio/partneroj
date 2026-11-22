import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  passkeyRegistration,
  type PasskeyRegistration,
} from "@partneroj/contracts";
import {
  activeCredentials,
  createChallenge,
  type Database,
  PasskeyRefused,
  registerPasskey,
  type SessionMember,
} from "@partneroj/db";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

import { DATABASE } from "../database/database.module.js";
import { ZodBody } from "../validation/zod-body.pipe.js";
import { CurrentMember, SessionGuard } from "./session.guard.js";
import { WEBAUTHN, type WebAuthnConfig } from "./webauthn.js";

type RegistrationOptions = Awaited<
  ReturnType<typeof generateRegistrationOptions>
>;

/** A uuid as its 16 bytes: an opaque user handle, without the name. */
const uuidBytes = (id: string) => Buffer.from(id.replaceAll("-", ""), "hex");

/**
 * Registering a passkey (plan section 6, "Passkey"), for a member who is
 * signed in, readers included. SimpleWebAuthn checks the signature, the
 * site and the fingerprint; the database keeps the challenge to one use
 * by this session (registerPasskey).
 */
@Controller("auth/passkeys")
@UseGuards(SessionGuard)
export class PasskeysController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WEBAUTHN) private readonly webauthn: WebAuthnConfig,
  ) {}

  /** What navigator.credentials.create() needs, with a new challenge. */
  @Post("register/options")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async registrationOptions(
    @CurrentMember() member: SessionMember,
  ): Promise<RegistrationOptions> {
    const challenge = await createChallenge(this.db, {
      purpose: "register",
      sessionId: member.sessionId,
    });
    const existing = await activeCredentials(this.db, member.memberId);
    return generateRegistrationOptions({
      rpName: this.webauthn.rpName,
      rpID: this.webauthn.rpID,
      userName: member.name,
      userDisplayName: member.name,
      userID: uuidBytes(member.memberId),
      // As bytes: a string would be taken as UTF-8 text and encoded again,
      // and the phone would sign another value than the one stored.
      challenge: isoBase64URL.toBuffer(challenge),
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports,
      })),
      // Discoverable, so signing in asks for no name; and the fingerprint
      // or face, not only a tap.
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
  }

  /** The phone's answer: checked, then saved with its challenge used. */
  @Post("register")
  @HttpCode(204)
  async register(
    @CurrentMember() member: SessionMember,
    @Body(new ZodBody(passkeyRegistration)) body: PasskeyRegistration,
  ): Promise<void> {
    // The library hands over the challenge the phone signed; whether it
    // can be used is the database's to say, below.
    let signed: string | undefined;
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: (challenge) => {
        signed = challenge;
        return true;
      },
      expectedOrigin: this.webauthn.origin,
      expectedRPID: this.webauthn.rpID,
      requireUserVerification: true,
    }).catch(() => ({ verified: false as const }));
    // When verified, the library has called expectedChallenge, so signed
    // is set; the second test is there for the compiler.
    if (!verification.verified || signed === undefined) {
      throw new BadRequestException("passkey_not_verified");
    }

    const { credential } = verification.registrationInfo;
    try {
      await registerPasskey(this.db, {
        sessionId: member.sessionId,
        challenge: signed,
        credential: {
          credentialId: credential.id,
          publicKey: isoBase64URL.fromBuffer(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? [],
        },
      });
    } catch (error) {
      if (!(error instanceof PasskeyRefused)) throw error;
      if (error.reason === "credential-taken") {
        throw new ConflictException("credential_taken");
      }
      throw new BadRequestException("challenge_not_usable");
    }
  }
}
