// The pieces the API's documentation (openapi.ts) is made of: its types,
// the conversion of a contract's Zod schema into JSON Schema, the answers
// most routes share, and the routes of accounts and categories, which
// are the same for both lists.
import { choiceChange, choiceListQuery, newChoice } from "@partneroj/contracts";
import { z } from "zod";
export type JsonSchema = Record<string, unknown>;

export interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema: JsonSchema;
}

export interface Operation {
  /** Set by withOperationIds, from the method and the path. */
  operationId?: string;
  summary: string;
  description?: string;
  tags: string[];
  /** [] for a route open to anyone; left out, the session is required. */
  security?: [];
  parameters?: Parameter[];
  requestBody?: {
    required: true;
    content: Record<string, { schema: JsonSchema }>;
  };
  responses: Record<string, { description: string }>;
}

export type Method = "get" | "post" | "put" | "patch" | "delete";

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
    license: { name: string; identifier: string };
  };
  servers: { url: string }[];
  components: {
    securitySchemes: Record<
      string,
      { type: "apiKey"; in: "cookie"; name: string }
    >;
  };
  security: Record<string, []>[];
  paths: Record<string, Partial<Record<Method, Operation>>>;
}

/** A schema as the request sends it: before trims and defaults. */
export const schema = (s: z.ZodType): JsonSchema => {
  const { $schema, ...rest } = z.toJSONSchema(s, {
    io: "input",
    target: "draft-2020-12",
  });
  void $schema;
  return rest;
};

export const json = (s: z.ZodType) => ({
  required: true as const,
  content: { "application/json": { schema: schema(s) } },
});

/** Each field of a query schema as a query parameter. */
export function query(s: z.ZodObject): Parameter[] {
  const { properties = {}, required = [] } = schema(s) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return Object.entries(properties).map(([name, field]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: field,
  }));
}

export const id = (name: string, description: string): Parameter => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", format: "uuid" },
});

export const open = { security: [] as [] };

// The answers most routes share.
export const unauthorized = {
  "401": { description: "No session, or it expired." },
};
export const adminsOnly = { "403": { description: "Only admins." } };
export const badBody = {
  "400": {
    description: "The body is invalid: `fields` lists which, never the values.",
  },
};
export const noStore = "Answered with `Cache-Control: no-store`.";

/** One list, accounts or categories: the same routes and answers. */
export function choiceRoutes(
  list: "accounts" | "categories",
  label: string,
): OpenApiDocument["paths"] {
  const tags = ["Accounts and categories"];
  return {
    [`/${list}`]: {
      get: {
        summary: `List the ${label}`,
        description: `The partnership's ${label} by name, for every member, readers included. The archived ones only with \`?archived=include\`. ${noStore}`,
        tags,
        parameters: query(choiceListQuery),
        responses: {
          "200": {
            description: `The ${label}: \`id\`, \`name\`, \`archivedAt\` (ISO 8601, or null).`,
          },
          "400": { description: "An unknown value of `archived`." },
          ...unauthorized,
        },
      },
      post: {
        summary: `Create one of the ${label}`,
        description: "The name is trimmed; it has 1 to 60 characters.",
        tags,
        requestBody: json(newChoice),
        responses: {
          "201": { description: "Created, as `GET` lists it." },
          ...badBody,
          ...unauthorized,
          ...adminsOnly,
          "409": {
            description: "`name-taken`: the partnership already has this name.",
          },
        },
      },
    },
    [`/${list}/{id}`]: {
      patch: {
        summary: `Rename, archive or restore one of the ${label}`,
        description:
          "One change per request: either `{ name }` or `{ archived }`. An archived one leaves the buttons and is never deleted: entries point at it.",
        tags,
        parameters: [id("id", `One of the partnership's ${label}.`)],
        requestBody: json(choiceChange),
        responses: {
          "200": { description: "Changed (or already so), as `GET` lists it." },
          ...badBody,
          ...unauthorized,
          ...adminsOnly,
          "404": {
            description: "`not-found`: not the partnership's, or not an id.",
          },
          "409": {
            description:
              list === "accounts"
                ? "`name-taken`; or `account-not-empty`: an account is archived only with a zero balance."
                : "`name-taken`.",
          },
        },
      },
    },
  };
}

/**
 * Names each operation by its method and path, as "POST
 * /entries/{entryId}/reverse" becomes postEntriesEntryIdReverse: unique,
 * since no two routes share both, and renamed with the route itself.
 */
export function withOperationIds(
  paths: OpenApiDocument["paths"],
): OpenApiDocument["paths"] {
  const words = (path: string) =>
    path
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w !== "")
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join("");
  return Object.fromEntries(
    Object.entries(paths).map(([path, item]) => [
      path,
      Object.fromEntries(
        Object.entries(item).map(([method, operation]) => [
          method,
          { operationId: method + words(path), ...operation },
        ]),
      ),
    ]),
  );
}
