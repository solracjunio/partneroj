import "reflect-metadata";

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  addCategories,
  categories,
  createInvite,
  createPartnership,
  createProject,
  installJobQueue,
  type PgBoss,
  recordExpense,
  startJobQueue,
} from "@partneroj/db";
import {
  type AppConnection,
  connectAsApp,
  startTestDatabase,
  type TestDatabase,
} from "@partneroj/db/testing";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { DATABASE } from "../database/database.module.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { MAX_UPLOAD_BYTES } from "./receipts.controller.js";
import { DiskStorage, RECEIPT_STORAGE } from "./storage.js";

// The HTTP server type supertest accepts (its "supertest/types" subpath is not exported).
type App = Parameters<typeof request>[0];

let t: TestDatabase;
let conn: AppConnection;
let boss: PgBoss;
let root: string;
let app: INestApplication<App>;

beforeAll(async () => {
  t = await startTestDatabase();
  await installJobQueue(t.connectionString);
  conn = await connectAsApp(t);
  boss = await startJobQueue(conn.connectionString, { sendOnly: true });
  root = await mkdtemp(join(tmpdir(), "receipts-api-"));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(conn.db)
    .overrideProvider(JOB_QUEUE)
    .useValue(boss)
    .overrideProvider(RECEIPT_STORAGE)
    .useValue(new DiskStorage(root))
    .compile();
  app = moduleRef.createNestApplication();
  // Listening once, here: supertest would otherwise open and close the
  // server per request, and these tests sign in (one request) while
  // building another.
  await app.listen(0);
});

afterAll(async () => {
  await app?.close();
  await t?.stop();
  await rm(root, { recursive: true, force: true });
});

const http = () => request(app.getHttpServer());

function cookieOf(setCookie: unknown): string {
  const [first] = setCookie as string[];
  return first!.split(";")[0]!;
}

async function signIn(memberId: string): Promise<string> {
  const { token } = await createInvite(conn.db, { memberId, createdBy: null });
  const response = await http()
    .post(`/auth/invites/${token}/accept`)
    .expect(204);
  return cookieOf(response.headers["set-cookie"]);
}

/** João (admin) recorded an expense; Leo is a reader. */
async function seed(name = "Obra Teste") {
  const p = await createPartnership(conn.db, {
    name,
    members: [
      { name: "João", role: "admin" },
      { name: "Maria", role: "admin" },
      { name: "Leo", role: "reader" },
    ],
    actorId: null,
  });
  const [joao, maria, leo] = p.members.map((m) => m.id);
  const project = await createProject(conn.db, {
    partnershipId: p.id,
    name: "Casa",
    kind: "construction",
    startsOn: "2027-01-11",
    weights: [
      { memberId: joao!, weight: 1 },
      { memberId: maria!, weight: 1 },
    ],
    actorId: null,
  });
  await addCategories(conn.db, {
    partnershipId: p.id,
    names: ["Material"],
    actorId: null,
  });
  const [category] = await t.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.partnershipId, p.id));
  const entry = await recordExpense(
    conn.db,
    boss,
    { memberId: joao!, partnershipId: p.id },
    {
      projectId: project.id,
      amount: 15000n,
      categoryId: category!.id,
      occurredOn: "2027-01-12",
    },
  );
  return { joao: joao!, maria: maria!, leo: leo!, entryId: entry.id };
}

/** A small photo with a GPS position in its EXIF. */
const photo = () =>
  sharp({
    create: { width: 300, height: 200, channels: 3, background: "#36c" },
  })
    .jpeg()
    .withMetadata({
      exif: { IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1" } },
    })
    .toBuffer();

describe("POST /entries/:entryId/receipts", () => {
  it("stores the photo without its metadata and lets the partnership download it", async () => {
    const s = await seed();
    const upload = await http()
      .post(`/entries/${s.entryId}/receipts`)
      .set("Cookie", await signIn(s.joao))
      .set("Content-Type", "image/jpeg")
      .send(await photo())
      .expect(201);
    const body = upload.body as { id: string; contentType: string };
    expect(body.contentType).toBe("image/jpeg");

    // Another partner of the same partnership downloads it.
    const download = await http()
      .get(`/receipts/${body.id}`)
      .set("Cookie", await signIn(s.maria))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(download.headers["content-type"]).toBe("image/jpeg");
    expect(download.headers["cache-control"]).toContain("private");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      (await sharp(download.body as Buffer).metadata()).exif,
    ).toBeUndefined();
  });

  it("answers the same receipt when the photo is sent twice", async () => {
    const s = await seed();
    const cookie = await signIn(s.joao);
    const file = await photo();
    const send = () =>
      http()
        .post(`/entries/${s.entryId}/receipts`)
        .set("Cookie", cookie)
        .set("Content-Type", "image/jpeg")
        .send(file)
        .expect(201);
    const first = (await send()).body as { id: string };
    const again = (await send()).body as { id: string };
    expect(again.id).toBe(first.id);
    expect(await readdir(join(root, "receipts", s.entryId))).toHaveLength(1);
  });

  it("answers 415 for a HEIC photo, with the reason for the app", async () => {
    const s = await seed();
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypheic"),
      Buffer.alloc(64),
    ]);
    const response = await http()
      .post(`/entries/${s.entryId}/receipts`)
      .set("Cookie", await signIn(s.joao))
      .set("Content-Type", "image/heic")
      .send(heic)
      .expect(415);
    expect(response.body).toMatchObject({
      message: "photo-format-not-supported",
    });
  });

  it("answers 415 for a file named as a photo that is not one", async () => {
    const s = await seed();
    await http()
      .post(`/entries/${s.entryId}/receipts`)
      .set("Cookie", await signIn(s.joao))
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("<script>alert(1)</script>"))
      .expect(415);
  });

  it("answers 413 above 10 MB", async () => {
    const s = await seed();
    await http()
      .post(`/entries/${s.entryId}/receipts`)
      .set("Cookie", await signIn(s.joao))
      .set("Content-Type", "image/jpeg")
      .send(Buffer.alloc(MAX_UPLOAD_BYTES + 1))
      .expect(413);
  });

  it("answers 404 for an entry of another partnership, storing nothing", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    await http()
      .post(`/entries/${theirs.entryId}/receipts`)
      .set("Cookie", await signIn(ours.joao))
      .set("Content-Type", "image/jpeg")
      .send(await photo())
      .expect(404);
    await expect(
      readdir(join(root, "receipts", theirs.entryId)),
    ).rejects.toThrow();
  });

  it("refuses a reader", async () => {
    const s = await seed();
    await http()
      .post(`/entries/${s.entryId}/receipts`)
      .set("Cookie", await signIn(s.leo))
      .set("Content-Type", "image/jpeg")
      .send(await photo())
      .expect(403);
  });
});

describe("GET /receipts/:receiptId", () => {
  it("answers 404 to another partnership", async () => {
    const ours = await seed();
    const theirs = await seed("Outra Obra");
    const upload = await http()
      .post(`/entries/${ours.entryId}/receipts`)
      .set("Cookie", await signIn(ours.joao))
      .set("Content-Type", "image/jpeg")
      .send(await photo())
      .expect(201);
    await http()
      .get(`/receipts/${(upload.body as { id: string }).id}`)
      .set("Cookie", await signIn(theirs.joao))
      .expect(404);
  });

  it("answers 401 without a session", async () => {
    await http()
      .get("/receipts/01a1c25b-7bf8-7cea-b37d-5194960ba97f")
      .expect(401);
  });
});
