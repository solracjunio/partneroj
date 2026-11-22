// The routes of getting in (plan section 6) for the API documentation:
// invites, the session and passkeys. Apart from openapi.ts because block 3
// keeps adding to them; the rest of the document doesn't change with them.
import { passkeyLogin, passkeyRegistration } from "@partneroj/contracts";

import {
  adminsOnly,
  id,
  json,
  noStore,
  open,
  type OpenApiDocument,
  unauthorized,
} from "./openapi-parts.js";

export function accessRoutes(): OpenApiDocument["paths"] {
  return {
    "/invites/{token}": {
      get: {
        summary: "Preview an invite",
        description: `Who the invite is for and to which partnership, before accepting it. ${noStore}`,
        tags: ["Access"],
        ...open,
        parameters: [
          {
            name: "token",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "`memberName`, `partnershipName`." },
          "404": {
            description:
              "`invite_not_usable`: unknown, used, revoked or expired.",
          },
        },
      },
    },
    "/auth/invites/{token}/accept": {
      post: {
        summary: "Accept an invite",
        description:
          "Signs in on this device: the answer sets the session cookie. The invite works once.",
        tags: ["Access"],
        ...open,
        parameters: [
          {
            name: "token",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "204": {
            description: "Signed in; `Set-Cookie` carries the session.",
          },
          "404": { description: "`invite_not_usable`." },
        },
      },
    },
    "/me": {
      get: {
        summary: "Who is signed in",
        description: noStore,
        tags: ["Access"],
        responses: {
          "200": {
            description:
              "`memberId`, `partnershipId`, `name`, `role`, and `hasPasskey`: whether the member has a passkey not revoked.",
          },
          ...unauthorized,
        },
      },
    },
    "/auth/passkeys/register/options": {
      post: {
        summary: "Start registering a passkey",
        description: `The options for \`navigator.credentials.create()\`, with a new challenge for this session, valid for 5 minutes: a discoverable passkey with the fingerprint or face, for this site. Readers too. ${noStore}`,
        tags: ["Access"],
        responses: {
          "200": {
            description:
              "WebAuthn's `PublicKeyCredentialCreationOptionsJSON`; `excludeCredentials` lists the member's passkeys.",
          },
          ...unauthorized,
        },
      },
    },
    "/auth/passkeys/register": {
      post: {
        summary: "Register a passkey",
        description:
          "The phone's answer to the options. The signature, the site and the fingerprint are checked; the challenge works once, in the session that asked for it.",
        tags: ["Access"],
        requestBody: json(passkeyRegistration),
        responses: {
          "204": { description: "Saved." },
          "400": {
            description:
              "`invalid_body`; `passkey_not_verified`: a wrong signature, site or page, or no fingerprint; `challenge_not_usable`: unknown, used, expired or another session's.",
          },
          ...unauthorized,
          "409": {
            description: "`credential_taken`: this passkey is already saved.",
          },
        },
      },
    },
    "/auth/passkeys/login/options": {
      post: {
        summary: "Start signing in with a passkey",
        description: `The options for \`navigator.credentials.get()\`, with a new challenge valid for 5 minutes. No session needed, and no name: the phone offers the passkeys it has for this site. ${noStore}`,
        tags: ["Access"],
        ...open,
        responses: {
          "200": {
            description: "WebAuthn's `PublicKeyCredentialRequestOptionsJSON`.",
          },
        },
      },
    },
    "/auth/passkeys/login": {
      post: {
        summary: "Sign in with a passkey",
        description:
          "The phone's answer to the options. The signature, the site, the fingerprint and the counter are checked; the challenge works once. Signs in on this device, as accepting an invite does.",
        tags: ["Access"],
        ...open,
        requestBody: json(passkeyLogin),
        responses: {
          "204": {
            description: "Signed in; `Set-Cookie` carries the session.",
          },
          "400": {
            description:
              "`invalid_body`; `passkey_not_verified`: a wrong signature, site, page or user handle, no fingerprint, or a counter that didn't go up; `challenge_not_usable`: unknown, used, expired or to register.",
          },
          "401": {
            description:
              "`passkey_unknown`: not a saved passkey, or revoked; the member needs an invite.",
          },
        },
      },
    },
    "/members/{memberId}/invites": {
      post: {
        summary: "Invite a member",
        description: `A new one-tap link for a member of the partnership; any pending invite of theirs stops working. The token is shown once. ${noStore}`,
        tags: ["Access"],
        parameters: [id("memberId", "A member of the partnership.")],
        responses: {
          "201": { description: "`token` and `expiresAt` (24 hours)." },
          ...unauthorized,
          ...adminsOnly,
          "404": { description: "Not a member of the partnership." },
        },
      },
    },
    "/members/{memberId}/sessions/revoke": {
      post: {
        summary: "Sign a member out everywhere",
        description: "After a lost phone.",
        tags: ["Access"],
        parameters: [id("memberId", "A member of the partnership.")],
        responses: {
          "200": { description: "`revoked`: how many sessions ended." },
          ...unauthorized,
          ...adminsOnly,
          "404": { description: "Not a member of the partnership." },
        },
      },
    },
  };
}
