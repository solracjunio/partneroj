import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { EntriesModule } from "./entries/entries.module.js";
import { HealthController } from "./health/health.controller.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { ReceiptsModule } from "./receipts/receipts.module.js";

@Module({
  imports: [
    DatabaseModule,
    JobsModule,
    AuthModule,
    EntriesModule,
    ReceiptsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
