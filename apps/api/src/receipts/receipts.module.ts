import { Module } from "@nestjs/common";

import { SessionGuard } from "../auth/session.guard.js";
import { ReceiptsController } from "./receipts.controller.js";
import { DiskStorage, RECEIPT_STORAGE } from "./storage.js";

@Module({
  controllers: [ReceiptsController],
  providers: [
    SessionGuard,
    {
      provide: RECEIPT_STORAGE,
      useFactory: () => {
        const root = process.env["UPLOADS_DIR"];
        if (root === undefined || root === "") {
          throw new Error("UPLOADS_DIR is not set");
        }
        return new DiskStorage(root);
      },
    },
  ],
})
export class ReceiptsModule {}
