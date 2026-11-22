import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module.js";
import { configureHttp } from "./http.js";

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttp(app);
  app.enableShutdownHooks();

  const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
  await app.listen(port);
}

await bootstrap();
