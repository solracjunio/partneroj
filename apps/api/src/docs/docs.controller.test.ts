import "reflect-metadata";

import type { INestApplication, Type } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants.js";
import { Test } from "@nestjs/testing";
import { choiceChange, newExpense } from "@partneroj/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.module.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { RECEIPT_STORAGE } from "../receipts/storage.js";
import { openApiDocument, SCALAR_INTEGRITY, SCALAR_URL } from "./openapi.js";

// The HTTP server type supertest accepts (its "supertest/types" subpath is not exported).
type App = Parameters<typeof request>[0];

// No database: these routes read nothing, and the guarded ones are only
// listed, never called. The stand-ins only need what closing them calls.
let app: INestApplication<App>;
beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue({ $client: { end: async () => {} } })
    .overrideProvider(JOB_QUEUE)
    .useValue({ stop: async () => {} })
    .overrideProvider(RECEIPT_STORAGE)
    .useValue({})
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});
afterAll(async () => {
  await app?.close();
});

const http = () => request(app.getHttpServer());

/**
 * Every route the API serves, as "GET /entries/{entryId}", read from what
 * the decorators record on each controller of each module of AppModule.
 */
function servedRoutes(): string[] {
  const modules: Type[] = [
    AppModule,
    ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ??
      []) as Type[]),
  ];
  const routes: string[] = [];
  for (const module of modules) {
    const controllers = (Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      module,
    ) ?? []) as Type[];
    for (const controller of controllers) {
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== "function") continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as
          string | undefined;
        if (method === undefined || path === undefined) continue;
        const full = `/${[prefix, path].join("/")}`
          .replace(/\/+/g, "/")
          .replace(/(.)\/$/, "$1")
          .replace(/:(\w+)/g, "{$1}");
        routes.push(`${RequestMethod[method]} ${full}`);
      }
    }
  }
  return routes.sort();
}

function documentedRoutes(): string[] {
  const routes: string[] = [];
  for (const [path, item] of Object.entries(openApiDocument().paths)) {
    for (const method of Object.keys(item)) {
      routes.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return routes.sort();
}

describe("the API documentation", () => {
  // A route added without its documentation, or documentation left for a
  // route that is gone, fails here.
  it("documents every route the API serves, and only those", () => {
    expect(servedRoutes().length).toBeGreaterThan(20);
    expect(documentedRoutes()).toEqual(servedRoutes());
  });

  it("takes each body from the contract the route validates with", () => {
    const paths = openApiDocument().paths;
    // As the document has it: no "$schema" inside an OpenAPI document.
    const converted = (s: z.ZodType) => {
      const { $schema, ...rest } = z.toJSONSchema(s, {
        io: "input",
        target: "draft-2020-12",
      });
      void $schema;
      return rest;
    };
    const bodyOf = (path: string, method: "post" | "patch") =>
      paths[path]![method]!.requestBody!.content["application/json"]!.schema;
    expect(bodyOf("/entries/expenses", "post")).toEqual(converted(newExpense));
    expect(bodyOf("/accounts/{id}", "patch")).toEqual(converted(choiceChange));
  });

  // The operation's stable name: the page's links, and a client's names.
  it("names each operation by its method and path, each name once", () => {
    const ids = Object.values(openApiDocument().paths).flatMap((item) =>
      Object.values(item).map((operation) => operation.operationId),
    );
    expect(ids).toContain("postEntriesEntryIdReverse");
    expect(ids).toContain("getProjectsCurrentBalances");
    expect(ids).toContain("getOpenapiJson");
    expect(new Set(ids).size).toBe(servedRoutes().length);
  });

  it("states the repository's license", () => {
    expect(openApiDocument().info.license).toEqual({
      name: "MIT",
      identifier: "MIT",
    });
  });

  it("turns a query schema into its parameters", () => {
    const paths = openApiDocument().paths;
    expect(paths["/accounts"]!.get!.parameters).toEqual([
      {
        name: "archived",
        in: "query",
        required: false,
        schema: { type: "string", const: "include" },
      },
    ]);
  });

  it("says which routes need a session", () => {
    const paths = openApiDocument().paths;
    expect(paths["/health"]!.get!.security).toEqual([]);
    expect(paths["/invites/{token}"]!.get!.security).toEqual([]);
    expect(paths["/accounts"]!.get!.security).toBeUndefined();
  });

  it("is served as JSON without a session", async () => {
    const response = await http()
      .get("/openapi.json")
      .expect(200)
      .expect("Content-Type", /application\/json/);
    expect((response.body as { openapi: string }).openapi).toBe("3.1.0");
  });

  it("is shown by Scalar, pinned and checked by its hash", async () => {
    const response = await http()
      .get("/docs")
      .expect(200)
      .expect("Content-Type", /text\/html/);
    expect(SCALAR_URL).toBe(
      "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.4/dist/browser/standalone.js",
    );
    // The file's sha384 on 18/11/2026; a new version needs a new hash.
    expect(SCALAR_INTEGRITY).toBe(
      "sha384-hwB9WroDTpZaI38gr+u9CXA6ksz5gUYgD2GxXazKl/agT1L2GWUiRFWGJYNiFu4Q",
    );
    expect(response.text).toContain(
      `<script src="${SCALAR_URL}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous"></script>`,
    );
    // Relative: /api/docs in production reads /api/openapi.json.
    expect(response.text).toContain(`url: "openapi.json"`);
  });
});
