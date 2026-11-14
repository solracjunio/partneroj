import { Module } from "@nestjs/common";

import { SessionGuard } from "../auth/session.guard.js";
import { BalancesController } from "./balances.controller.js";

@Module({
  controllers: [BalancesController],
  providers: [SessionGuard],
})
export class BalancesModule {}
