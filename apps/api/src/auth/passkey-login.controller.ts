import type { ServerResponse } from "node:http";

import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { passkeyLogin, type PasskeyLogin } from "@partneroj/contracts";
import {
  createChallenge,
  type Database,
  findCredential,
  PasskeyRefused,
  signInWithPasskey,
} from "@partneroj/db";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

import { DATABASE } from "../database/database.module.js";
import { ZodBody } from "../validation/zod-body.pipe.js";
import { sessionCookie } from "./cookies.js";
import { describeDevice } from "./device.js";
import { uuidBytes, WEBAUTHN, type WebAuthnConfig } from "./webauthn.js";

type AuthenticationOptions = Awaited<
  ReturnType<typeof generateAuthenticationOptions>
>;

/**
 * Signing in with a passkey (plan section 6, "Passkey"), without a
 * session: it is what makes one. SimpleWebAuthn checks the signature, the
 * site, the fingerprint and the counter; the database keeps the challenge
 * to one use and opens the session (signInWithPasskey).
 */
@Controller("auth/passkeys/login")
export class PasskeyLoginController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WEBAUTHN) private readonly webauthn: WebAuthnConfig,
  ) {}

  /** What navigator.credentials.get() needs, with a new challenge. */
  @Post("options")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async options(): Promise<AuthenticationOptions> {
    const challenge = await createChallenge(this.db, { purpose: "login" });
    return generateAuthenticationOptions({
      rpID: this.webauthn.rpID,
      // As bytes, as when registering (passkeys.controller.ts).
      challenge: isoBase64URL.toBuffer(challenge),
      // No allowCredentials: the passkey is discoverable, so the phone
      // offers the ones it has for this site, and nobody types a name.
      userVerification: "required",
    });
  }

  /** The phone's answer: checked, then a session and its cookie. */
  @Post()
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async login(
    @Body(new ZodBody(passkeyLogin)) body: PasskeyLogin,
    @Headers("user-agent") userAgent: string | undefined,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const passkey = await findCredential(this.db, body.id);
    if (passkey === null) throw new UnauthorizedException("passkey_unknown");

    // SimpleWebAuthn doesn't compare the user handle with the passkey's
    // owner; a phone that sends another member's is not to be trusted.
    if (
      body.response.userHandle !==
      isoBase64URL.fromBuffer(uuidBytes(passkey.memberId))
    ) {
      throw new BadRequestException("passkey_not_verified");
    }

    // As when registering: the library hands over the signed challenge,
    // and the database says whether it can be used.
    let signed: string | undefined;
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: (challenge) => {
        signed = challenge;
        return true;
      },
      expectedOrigin: this.webauthn.origin,
      expectedRPID: this.webauthn.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    }).catch(() => ({ verified: false as const }));
    // When verified, signed is set; the second test is for the compiler.
    if (!verification.verified || signed === undefined) {
      throw new BadRequestException("passkey_not_verified");
    }

    try {
      const { sessionToken } = await signInWithPasskey(this.db, {
        challenge: signed,
        credentialId: passkey.credentialId,
        counter: verification.authenticationInfo.newCounter,
        device: describeDevice(userAgent),
      });
      response.setHeader("Set-Cookie", sessionCookie(sessionToken));
    } catch (error) {
      if (!(error instanceof PasskeyRefused)) throw error;
      // Revoked since findCredential, or another sign-in took the counter.
      if (error.reason === "passkey-not-usable") {
        throw new UnauthorizedException("passkey_unknown");
      }
      throw new BadRequestException("challenge_not_usable");
    }
  }
}
