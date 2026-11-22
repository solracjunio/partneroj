// Passkeys on this phone (plan section 6, "Passkey"): whether one can be
// made here, and making it. The phone keeps the private key; the API
// keeps the public one (apps/api/src/auth/passkeys.controller.ts).
import {
  platformAuthenticatorIsAvailable,
  type RegistrationResponseJSON,
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
