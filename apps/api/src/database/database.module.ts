import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createDatabase, type Database } from "@partneroj/db";

/** Injection token of the Database: `@Inject(DATABASE) db: Database`. */
export const DATABASE = Symbol("DATABASE");

/**
 * One connection pool for the whole API. Global, so every module can
 * inject it without importing this one. Tests replace it with
 * `overrideProvider(DATABASE)`.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Database => {
        const url = process.env["DATABASE_URL"];
        if (url === undefined || url === "") {
          throw new Error("DATABASE_URL is not set");
        }
        return createDatabase(url);
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Lets the open queries finish, then closes the connections. */
  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end();
  }
}
