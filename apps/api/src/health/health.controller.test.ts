import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabase } from "@partneroj/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.module.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { RECEIPT_STORAGE } from "../receipts/storage.js";

// The HTTP server type supertest accepts (its "supertest/types" subpath is not exported).
type App = Parameters<typeof request>[0];

describe("GET /health", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // /health doesn't touch the database. A pool connects only on its
    // first query, so this one never opens a connection.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DATABASE)
      .useValue(createDatabase("postgres://unused@127.0.0.1:1/unused"))
      .overrideProvider(JOB_QUEUE)
      .useValue({ stop: () => Promise.resolve() })
      .overrideProvider(RECEIPT_STORAGE)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns ok", async () => {
    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
