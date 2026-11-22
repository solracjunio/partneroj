// Passkeys on this phone (plan section 6, "Passkey"): whether one can be
// made here, making it, and signing in with it. The phone keeps the private key; the API
// keeps the public one (apps/api/src/auth/passkeys.controller.ts).
import {
  type AuthenticationResponseJSON,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  type RegistrationResponseJSON,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";

import { api } from "./api";

/**
 * Whether this phone can make a passkey behind its fingerprint, face or
 * screen lock. Without one, the API's "userVerification: required" would
 * refuse it, so the card is not shown at all (decided on 2026-11-22).
 */
export async function passkeySupported(): Promise<boolean> {
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/**
 * - "saved": the API keeps the new passkey.
 * - "already": this phone's passkey was there already; as good as saved.
 * - "cancelled": the partner closed the phone's question, or it timed out.
 * - "failed": anything else; trying again is safe.
 */
export type PasskeyResult = "saved" | "already" | "cancelled" | "failed";

/**
 * "Cadastrar digital": a challenge from the API, the phone's passkey for
 * it, then the API checks and keeps it. Must run from the tap: browsers
 * may refuse to ask for the fingerprint otherwise.
 */
export async function protectWithPasskey(): Promise<PasskeyResult> {
  const options = await api.passkeyOptions();
  if (!options.ok) return "failed";

  let answer: RegistrationResponseJSON;
  try {
    answer = await startRegistration({ optionsJSON: options.value });
  } catch (error) {
    // The instanceof tests are for the compiler: the library throws only
    // Errors, and only its WebAuthnError has a code.
    // The API listed this member's passkeys (excludeCredentials), and the
    // phone holds one of them.
    if (
      error instanceof WebAuthnError &&
      error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED"
    ) {
      return "already";
    }
    // The library wraps it, but keeps the browser's name for it.
    if (error instanceof Error && error.name === "NotAllowedError") {
      return "cancelled";
    }
    return "failed";
  }

  const saved = await api.registerPasskey(answer);
  if (saved.ok) return "saved";
  return saved.failure === "conflict" ? "already" : "failed";
}

/**
 * Whether "Entrar com a digital" can work here. Any browser with WebAuthn,
 * even without a fingerprint of its own: it can sign in with a passkey on
 * another phone, by its QR code (decided on 2026-11-22).
 */
export function canSignInWithPasskey(): boolean {
  return browserSupportsWebAuthn();
}

/**
 * - "in": the API set the session cookie.
 * - "unknown": the API doesn't know this passkey, or it was revoked; only
 *   a new invite lets the member in.
 * - "cancelled": the partner closed the phone's question, or it timed out.
 * - "busy": too many tries from this address; a minute fixes it.
 * - "failed": anything else; trying again is safe.
 */
export type PasskeyLoginResult =
  "in" | "unknown" | "cancelled" | "busy" | "failed";

/**
 * "Entrar com a digital": a challenge from the API, the phone's signature,
 * and the API opens a session. Runs from the tap, as when registering.
 */
export async function enterWithPasskey(): Promise<PasskeyLoginResult> {
  const options = await api.passkeyLoginOptions();
  if (!options.ok) return options.failure === "busy" ? "busy" : "failed";

  let answer: AuthenticationResponseJSON;
  try {
    answer = await startAuthentication({ optionsJSON: options.value });
  } catch (error) {
    // As when registering: the library keeps the browser's name for it,
    // and instanceof is there for the compiler.
    if (error instanceof Error && error.name === "NotAllowedError") {
      return "cancelled";
    }
    return "failed";
  }

  const signedIn = await api.passkeyLogin(answer);
  if (signedIn.ok) return "in";
  if (signedIn.failure === "signed-out") return "unknown";
  return signedIn.failure === "busy" ? "busy" : "failed";
}
