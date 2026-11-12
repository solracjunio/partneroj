import { Module } from "@nestjs/common";

import { SessionGuard } from "../auth/session.guard.js";
import { FeedController } from "./feed.controller.js";

@Module({
  controllers: [FeedController],
  providers: [SessionGuard],
})
export class FeedModule {}
