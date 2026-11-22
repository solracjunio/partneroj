// The API's documentation (plan section 8), as OpenAPI 3.1, shown by
// Scalar at /api/docs. Each request body and query comes from the same
// @partneroj/contracts schema the route validates with, converted by Zod,
// so it can't drift from what the API accepts. The routes, their answers
// and their words are written here; docs.controller.test.ts fails when a
// route is served without being listed, or listed without being served.
// Responses are described in words: they are TypeScript types, which
// leave nothing at run time to convert.
import {
  feedQuery,
  idempotencyKey,
  idempotencyKeyHeader,
  markRead,
  newExpense,
  pushSubscription,
  reverseEntryBody,
} from "@partneroj/contracts";

import { SESSION_COOKIE } from "../auth/cookies.js";
import { accessRoutes } from "./openapi-access.js";
import {
  badBody,
  choiceRoutes,
  id,
  json,
  noStore,
  open,
  type OpenApiDocument,
  query,
  schema,
  unauthorized,
  withOperationIds,
} from "./openapi-parts.js";

export type { OpenApiDocument } from "./openapi-parts.js";

/**
 * Scalar, from a CDN at an exact version, checked by its hash: the
 * browser refuses the script if the CDN ever serves another file.
 */
export const SCALAR_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.4/dist/browser/standalone.js";
export const SCALAR_INTEGRITY =
  "sha384-hwB9WroDTpZaI38gr+u9CXA6ksz5gUYgD2GxXazKl/agT1L2GWUiRFWGJYNiFu4Q";

export function openApiDocument(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "Partneroj API",
      version: "1",
      // The repository's LICENSE.
      license: { name: "MIT", identifier: "MIT" },
      description:
        "The API of the Partneroj web app. Every route but a few needs the session cookie, which only the app sets: signing in is accepting an invite link. Amounts are cents as strings of digits (ADR 0005); entries are never changed, only reversed (ADR 0006).",
    },
    servers: [{ url: "/api" }],
    components: {
      securitySchemes: {
        session: { type: "apiKey", in: "cookie", name: SESSION_COOKIE },
      },
    },
    security: [{ session: [] }],
    paths: withOperationIds({
      "/health": {
        get: {
          summary: "Is the API up",
          tags: ["Health"],
          ...open,
          responses: { "200": { description: '`{ "status": "ok" }`.' } },
        },
      },
      ...accessRoutes(),
      "/projects/current": {
        get: {
          summary: "The project to record into",
          description: `The partnership's newest project and its category buttons (archived ones left out). ${noStore}`,
          tags: ["Entries"],
          responses: {
            "200": { description: "`project` and `categories`." },
            ...unauthorized,
            "404": { description: "`no_project`." },
          },
        },
      },
      "/projects/current/balances": {
        get: {
          summary: "Balances",
          description: `The current project's balances, for every member, readers included. ${noStore}`,
          tags: ["Balances"],
          responses: {
            "200": {
              description:
                "The result, each partner's balance and fair share, and each account's balance, in cents.",
            },
            ...unauthorized,
            "404": { description: "`no_project`." },
          },
        },
      },
      ...choiceRoutes("accounts", "accounts"),
      ...choiceRoutes("categories", "categories"),
      "/entries/expenses": {
        post: {
          summary: "Record a pocket expense",
          description: `Paid by whoever is signed in, from their own money: it counts as their contribution. Sent again with the same \`${idempotencyKeyHeader}\`, it returns the expense already recorded.`,
          tags: ["Entries"],
          parameters: [
            {
              name: idempotencyKeyHeader,
              in: "header",
              description: "The phone's key for this draft.",
              schema: schema(idempotencyKey),
            },
          ],
          requestBody: json(newExpense),
          responses: {
            "201": { description: "`id`, `amountCents`, `occurredOn`." },
            ...badBody,
            ...unauthorized,
            "403": { description: "A reader; or `payer-without-weight`." },
            "409": {
              description:
                "`key-reused`: the key came with a different expense.",
            },
            "422": {
              description:
                "`project-not-found`, `category-not-found` (another partnership's, or archived).",
            },
          },
        },
      },
      "/entries/{entryId}": {
        get: {
          summary: "One entry",
          description: `The entry with its receipts and its status (ADR 0006). ${noStore}`,
          tags: ["Entries"],
          parameters: [id("entryId", "An entry of the partnership.")],
          responses: {
            "200": {
              description:
                "The entry, who paid, recorded and undid it, and its receipts.",
            },
            ...unauthorized,
            "404": { description: "`entry-not-found`." },
          },
        },
      },
      "/entries/{entryId}/reverse": {
        post: {
          summary: "Undo an entry",
          description:
            "Only its author. The entry stays; a reversal with the sign inverted cancels it.",
          tags: ["Entries"],
          parameters: [id("entryId", "An entry of the partnership.")],
          requestBody: json(reverseEntryBody),
          responses: {
            "201": {
              description: "`id`, `reversalOf`, `amountCents` (negative).",
            },
            ...badBody,
            ...unauthorized,
            "403": { description: "`not-author`." },
            "404": { description: "`entry-not-found`." },
            "409": {
              description:
                "`already-reversed`, `reversal-of-reversal`, `corrected-by-ballot`, or `account-archived` (restore the account first).",
            },
            "422": { description: "`reason-required`, `account-overdrawn`." },
          },
        },
      },
      "/entries/{entryId}/receipts": {
        post: {
          summary: "Attach a receipt",
          description:
            "A photo (JPEG, PNG, WebP or HEIF) or a PDF, up to 10 MB, by who recorded the entry. The body is the file itself; its kind is read from its first bytes.",
          tags: ["Receipts"],
          parameters: [id("entryId", "An entry of the partnership.")],
          requestBody: {
            required: true,
            // What the file is comes from its first bytes, never from the
            // Content-Type the client sends.
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          responses: {
            "201": { description: "`id`, `contentType`, `sizeBytes`." },
            ...unauthorized,
            "403": { description: "Not who recorded the entry." },
            "404": { description: "Not an entry of the partnership." },
            "413": { description: "Larger than 10 MB." },
            "415": { description: "Not a photo or PDF, by its content." },
          },
        },
      },
      "/receipts/{receiptId}": {
        get: {
          summary: "Download a receipt",
          description: "The file, cached privately: a receipt never changes.",
          tags: ["Receipts"],
          parameters: [id("receiptId", "A receipt of the partnership.")],
          responses: {
            "200": { description: "The file." },
            ...unauthorized,
            "404": { description: "Not a receipt of the partnership." },
          },
        },
      },
      "/activities": {
        get: {
          summary: "The feed",
          description: `The partnership's activities, newest first, a page at a time. ${noStore}`,
          tags: ["Feed"],
          parameters: query(feedQuery),
          responses: {
            "200": {
              description:
                "`items` (each with `unread`) and `next`, the `before` of the next page or null.",
            },
            "400": { description: "`before` is not an id." },
            ...unauthorized,
          },
        },
      },
      "/activities/unread": {
        get: {
          summary: "How many are unread",
          description: noStore,
          tags: ["Feed"],
          responses: {
            "200": { description: "`count`." },
            ...unauthorized,
          },
        },
      },
      "/activities/read": {
        post: {
          summary: "Mark activities read",
          tags: ["Feed"],
          requestBody: json(markRead),
          responses: {
            "204": { description: "Marked." },
            ...badBody,
            ...unauthorized,
          },
        },
      },
      "/notifications/vapid-key": {
        get: {
          summary: "The push key",
          description: "The public key a phone subscribes to push with.",
          tags: ["Notifications"],
          responses: {
            "200": { description: "`publicKey`." },
            ...unauthorized,
            "503": { description: "`push_not_configured`." },
          },
        },
      },
      "/notifications/subscription": {
        put: {
          summary: "Turn notices on for this device",
          tags: ["Notifications"],
          requestBody: json(pushSubscription),
          responses: {
            "204": { description: "Saved." },
            ...badBody,
            ...unauthorized,
          },
        },
        delete: {
          summary: "Turn notices off for this device",
          tags: ["Notifications"],
          responses: {
            "204": { description: "Removed (or there was none)." },
            ...unauthorized,
          },
        },
      },
      "/openapi.json": {
        get: {
          summary: "This document",
          tags: ["Documentation"],
          ...open,
          responses: { "200": { description: "OpenAPI 3.1." } },
        },
      },
      "/docs": {
        get: {
          summary: "This page",
          tags: ["Documentation"],
          ...open,
          responses: { "200": { description: "HTML, shown by Scalar." } },
        },
      },
    }),
  };
}
