import { Module } from "@nestjs/common";

import { InvitesController, SessionsController } from "./auth.controller.js";
import { PasskeyLoginController } from "./passkey-login.controller.js";
import { PasskeysController } from "./passkeys.controller.js";
import { SessionGuard } from "./session.guard.js";
import { WEBAUTHN, webAuthnConfig } from "./webauthn.js";

@Module({
  controllers: [
    InvitesController,
    SessionsController,
    PasskeysController,
    PasskeyLoginController,
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
