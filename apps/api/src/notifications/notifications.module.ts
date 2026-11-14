import { Module } from "@nestjs/common";

import { SessionGuard } from "../auth/session.guard.js";
import { NotificationsController } from "./notifications.controller.js";
import { VAPID_PUBLIC_KEY } from "./vapid.js";

@Module({
  controllers: [NotificationsController],
  providers: [
    SessionGuard,
    {
      provide: VAPID_PUBLIC_KEY,
      // Not required here: production requires it in compose.yml.
      useFactory: (): string | null => {
        const key = process.env["VAPID_PUBLIC_KEY"];
        return key === undefined || key === "" ? null : key;
      },
    },
  ],
})
export class NotificationsModule {}
