import type { ServerResponse } from "node:http";

import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  acceptInvite,
  type Database,
  type InvitePreview,
  inviteMember,
  previewInvite,
  revokeSessions,
  type SessionMember,
} from "@partneroj/db";

import { DATABASE } from "../database/database.module.js";
import { isToken, sessionCookie } from "./cookies.js";
import { describeDevice } from "./device.js";
import { CurrentMember, SessionGuard } from "./session.guard.js";

/** Who is signed in, for the app's first screen. */
export interface Me {
  memberId: string;
  partnershipId: string;
  name: string;
  role: SessionMember["role"];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The invite (plan section 6). An invite that can't be used answers 404
 * whatever the reason (unknown, used, revoked or expired): the page shows
 * the same "ask for a new invite" for all of them.
 */
@Controller()
export class InvitesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The invite page's "Olá, Maria". Opening the link uses nothing. */
  @Get("invites/:token")
  @Header("Cache-Control", "no-store")
  async preview(@Param("token") token: string): Promise<InvitePreview> {
    const preview = isToken(token) ? await previewInvite(this.db, token) : null;
    if (preview === null) throw new NotFoundException("invite_not_usable");
    return preview;
  }

  /** The tap on the button: uses the invite and sets the session cookie. */
  @Post("auth/invites/:token/accept")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async accept(
    @Param("token") token: string,
    @Headers("user-agent") userAgent: string | undefined,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<void> {
    const accepted = isToken(token)
      ? await acceptInvite(this.db, token, describeDevice(userAgent))
      : null;
    if (accepted === null) throw new NotFoundException("invite_not_usable");
    response.setHeader("Set-Cookie", sessionCookie(accepted.sessionToken));
  }
}

@Controller()
@UseGuards(SessionGuard)
export class SessionsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get("me")
  @Header("Cache-Control", "no-store")
  me(@CurrentMember() member: SessionMember): Me {
    return {
      memberId: member.memberId,
      partnershipId: member.partnershipId,
      name: member.name,
      role: member.role,
    };
  }

  /**
   * A new invite link for a member (plan section 6): admins only. The
   * token is shown once; the app builds the link from it. Any pending
   * invite of the member stops working.
   */
  @Post("members/:memberId/invites")
  @Header("Cache-Control", "no-store")
  async invite(
    @CurrentMember() actor: SessionMember,
    @Param("memberId") memberId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    if (actor.role !== "admin") throw new ForbiddenException();
    const invite = UUID.test(memberId)
      ? await inviteMember(this.db, {
          actorId: actor.memberId,
          partnershipId: actor.partnershipId,
          memberId,
        })
      : null;
    if (invite === null) throw new NotFoundException();
    return invite;
  }

  /** After a lost phone (plan section 2): admins only. */
  @Post("members/:memberId/sessions/revoke")
  @HttpCode(200)
  async revoke(
    @CurrentMember() actor: SessionMember,
    @Param("memberId") memberId: string,
  ): Promise<{ revoked: number }> {
    if (actor.role !== "admin") throw new ForbiddenException();
    const revoked = UUID.test(memberId)
      ? await revokeSessions(this.db, {
          actorId: actor.memberId,
          partnershipId: actor.partnershipId,
          memberId,
        })
      : null;
    if (revoked === null) throw new NotFoundException();
    return { revoked };
  }
}
