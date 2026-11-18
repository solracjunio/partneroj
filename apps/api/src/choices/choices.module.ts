import { Module } from "@nestjs/common";

import { SessionGuard } from "../auth/session.guard.js";
import { ChoicesController } from "./choices.controller.js";

@Module({
  controllers: [ChoicesController],
  providers: [SessionGuard],
})
export class ChoicesModule {}
