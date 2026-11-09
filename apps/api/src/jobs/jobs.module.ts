import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { type PgBoss, startJobQueue } from "@partneroj/db";

/** Injection token of pg-boss: `@Inject(JOB_QUEUE) boss: PgBoss`. */
export const JOB_QUEUE = Symbol("JOB_QUEUE");

/**
 * pg-boss for the API, which only queues jobs (the push of a new entry,
 * in the entry's own transaction). The worker runs them and does
 * pg-boss's maintenance. Tests replace it with `overrideProvider`.
 */
@Global()
@Module({
  providers: [
    {
      provide: JOB_QUEUE,
      useFactory: async (): Promise<PgBoss> => {
        const url = process.env["DATABASE_URL"];
        if (url === undefined || url === "") {
          throw new Error("DATABASE_URL is not set");
        }
        return startJobQueue(url, { sendOnly: true });
      },
    },
  ],
  exports: [JOB_QUEUE],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(@Inject(JOB_QUEUE) private readonly boss: PgBoss) {}

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop();
  }
}
