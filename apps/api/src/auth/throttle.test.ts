import "reflect-metadata";

import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  type AppConnection,
  connectAsApp,
  startTestDatabase,
  type TestDatabase,
} from "@partneroj/db/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.module.js";
import { configureHttp } from "../http.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { RECEIPT_STORAGE } from "../receipts/storage.js";
import { PUBLIC_LIMIT_PER_MINUTE } from "./throttle.js";

let t: TestDatabase;
let conn: AppConnection;
let app: NestExpressApplication;

beforeAll(async () => {
  t = await startTestDatabase();
  conn = await connectAsApp(t);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(conn.db)
    .overrideProvider(JOB_QUEUE)
    .useValue({ stop: () => Promise.resolve() })
    .overrideProvider(RECEIPT_STORAGE)
    .useValue({})
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  // As in main.ts: the address is the one Caddy puts in X-Forwarded-For.
  configureHttp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close(); // Also ends conn.db's pool (DatabaseModule).
  await t?.stop();
});

type Call = (from: string) => request.Test;

const http = () => request(app.getHttpServer());

/**
 * The routes of getting in, each called so that it touches nothing: a
 * token that can't be one, a body that isn't an answer. Login options is
 * the one that writes, which is why the limit exists.
 */
const publicRoutes: { route: string; call: Call; status: number }[] = [
  {
    route: "GET /invites/:token",
    call: (from) =>
      http().get("/invites/not-a-token").set("X-Forwarded-For", from),
    status: 404,
  },
  {
    route: "POST /auth/invites/:token/accept",
    call: (from) =>
      http()
        .post("/auth/invites/not-a-token/accept")
        .set("X-Forwarded-For", from),
    status: 404,
  },
  {
    route: "POST /auth/passkeys/login/options",
    call: (from) =>
      http().post("/auth/passkeys/login/options").set("X-Forwarded-For", from),
    status: 200,
  },
  {
    route: "POST /auth/passkeys/login",
    call: (from) =>
      http().post("/auth/passkeys/login").set("X-Forwarded-For", from).send({}),
    status: 400,
  },
];

/** Uses up a route's minute from one address, checking each answer. */
async function useUp(call: Call, from: string, status: number) {
  for (let i = 0; i < PUBLIC_LIMIT_PER_MINUTE; i++) {
    await call(from).expect(status);
  }
}

describe("the limit on the routes of getting in", () => {
  it.each(publicRoutes.map((r, i) => ({ ...r, from: `203.0.113.${i + 1}` })))(
    `answers 429 to $route after ${PUBLIC_LIMIT_PER_MINUTE} a minute from one address`,
    async ({ call, status, from }) => {
      await useUp(call, from, status);
      const response = await call(from).expect(429);
      expect(response.body).toMatchObject({ message: "too_many_requests" });
    },
  );

  it("counts each address on its own, by the address Caddy forwards", async () => {
    const [preview] = publicRoutes;
    await useUp(preview!.call, "198.51.100.1", 404);
    await preview!.call("198.51.100.1").expect(429);
    await preview!.call("198.51.100.2").expect(404);
  });

  it("counts each route on its own", async () => {
    const [preview, accept] = publicRoutes;
    await useUp(preview!.call, "198.51.100.10", 404);
    await accept!.call("198.51.100.10").expect(404);
  });

  it("counts a phone's IPv6 by its /64, as it changes addresses within it", async () => {
    const [preview] = publicRoutes;
    await useUp(preview!.call, "2001:db8:1:1::1", 404);
    await preview!.call("2001:db8:1:1::2").expect(429);
    await preview!.call("2001:db8:1:2::1").expect(404);
  });

  it("leaves the routes behind a session alone", async () => {
    for (let i = 0; i <= PUBLIC_LIMIT_PER_MINUTE; i++) {
      await http()
        .get("/me")
        .set("X-Forwarded-For", "198.51.100.20")
        .expect(401);
    }
  });
});
