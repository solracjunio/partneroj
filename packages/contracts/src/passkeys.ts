// Passkeys (plan section 6, "Passkey"), shared by the API and the web app:
// what the browser sends after navigator.credentials.create(). The API
// checks the signature with SimpleWebAuthn; this only checks the shape.
import { z } from "zod";

/** URL-safe base64 without padding, as WebAuthn's JSON sends bytes. */
const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/);

/**
 * The browser's answer when registering a passkey (WebAuthn's
 * RegistrationResponseJSON). Not strict: each browser adds fields of its
 * own (publicKey, authenticatorData...), which are dropped here; the
 * signature is checked from attestationObject alone.
 */
export const passkeyRegistration = z.object({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: base64url,
    attestationObject: base64url,
    transports: z.array(z.string()).optional(),
  }),
  // No extensions are asked for, so none are kept.
  clientExtensionResults: z.object({}),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
});

export type PasskeyRegistration = z.infer<typeof passkeyRegistration>;
