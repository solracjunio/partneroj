import { Module } from "@nestjs/common";

import { InvitesController, SessionsController } from "./auth.controller.js";
import { SessionGuard } from "./session.guard.js";

@Module({
  controllers: [InvitesController, SessionsController],
  providers: [SessionGuard],
})
export class AuthModule {}
