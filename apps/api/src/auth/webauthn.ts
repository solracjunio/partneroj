// Where passkeys belong (plan section 6, "Passkey"): a passkey is made for
// one site, its RP ID, and the phone signs which page asked, its origin.
// Both come from PUBLIC_URL, the address the app is opened at.

/** Nest's token for the WebAuthnConfig. */
export const WEBAUTHN = Symbol("WEBAUTHN");

export interface WebAuthnConfig {
  /** The domain a passkey belongs to, e.g. partneroj.com.br. */
  rpID: string;
  /** The name the phone shows next to the passkey. */
  rpName: string;
  /** The page that may ask for a passkey, e.g. https://partneroj.com.br. */
  origin: string;
}

/**
 * The config from PUBLIC_URL, or an error that stops the API from starting
 * (decided on 2026-11-21): a passkey made for the wrong site would only
 * fail on the phones. Browsers allow WebAuthn only over HTTPS, or on
 * localhost for development.
 */
export function webAuthnConfig(publicUrl: string | undefined): WebAuthnConfig {
  if (publicUrl === undefined || publicUrl === "") {
    throw new Error("PUBLIC_URL is not set");
  }
  const url = new URL(publicUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("PUBLIC_URL must be https, or http on localhost");
  }
  return { rpID: url.hostname, rpName: "Partneroj", origin: url.origin };
}
