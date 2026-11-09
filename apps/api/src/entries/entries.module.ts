import { Module } from "@nestjs/common";

import { SessionGuard } from "../auth/session.guard.js";
import { EntriesController } from "./entries.controller.js";

@Module({
  controllers: [EntriesController],
  providers: [SessionGuard],
})
export class EntriesModule {}
