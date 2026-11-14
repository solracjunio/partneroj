import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Put,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import {
  pushSubscription,
  type PushSubscriptionBody,
  type VapidKey,
} from "@partneroj/contracts";
import {
  type Database,
  removeSubscription,
  saveSubscription,
  type SessionMember,
} from "@partneroj/db";

import { CurrentMember, SessionGuard } from "../auth/session.guard.js";
import { DATABASE } from "../database/database.module.js";
import { ZodBody } from "../validation/zod-body.pipe.js";
import { VAPID_PUBLIC_KEY } from "./vapid.js";

/**
 * Push notifications (plan section 4). The subscription is "this phone's":
 * the session is the key, so a member can only ever touch their own, and
 * every member subscribes, readers included.
 */
@Controller("notifications")
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(VAPID_PUBLIC_KEY) private readonly publicKey: string | null,
  ) {}

  /** The key the browser subscribes with. */
  @Get("vapid-key")
  vapidKey(): VapidKey {
    if (this.publicKey === null) {
      throw new ServiceUnavailableException("push_not_configured");
    }
    return { publicKey: this.publicKey };
  }

  /** "Ativar avisos": stores (or renews) this phone's subscription. */
  @Put("subscription")
  @HttpCode(204)
  async subscribe(
    @CurrentMember() member: SessionMember,
    @Body(new ZodBody(pushSubscription)) body: PushSubscriptionBody,
  ): Promise<void> {
    await saveSubscription(this.db, {
      sessionId: member.sessionId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
  }

  /** "Desligar avisos": this phone stops getting notifications. */
  @Delete("subscription")
  @HttpCode(204)
  async unsubscribe(@CurrentMember() member: SessionMember): Promise<void> {
    await removeSubscription(this.db, member.sessionId);
  }
}
