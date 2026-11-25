import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";

import { InvitesController, SessionsController } from "./auth.controller.js";
import { PasskeyLoginController } from "./passkey-login.controller.js";
import { PasskeysController } from "./passkeys.controller.js";
import { RolesController } from "./roles.controller.js";
import { SessionGuard } from "./session.guard.js";
import { throttleOptions } from "./throttle.js";
import { WEBAUTHN, webAuthnConfig } from "./webauthn.js";

@Module({
  imports: [ThrottlerModule.forRoot(throttleOptions)],
  controllers: [
    InvitesController,
    SessionsController,
    PasskeysController,
    PasskeyLoginController,
    RolesController,
  ],
  providers: [
    SessionGuard,
    {
      provide: WEBAUTHN,
      // Required: the API doesn't start without it (webauthn.ts).
      useFactory: () => webAuthnConfig(process.env["PUBLIC_URL"]),
    },
  ],
})
export class AuthModule {}
