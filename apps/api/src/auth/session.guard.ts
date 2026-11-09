import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { type Database, findSession, type SessionMember } from "@partneroj/db";

import { DATABASE } from "../database/database.module.js";
import { readCookie, SESSION_COOKIE, sessionCookie } from "./cookies.js";

/** A request that went through SessionGuard. */
export interface AuthenticatedRequest extends IncomingMessage {
  member?: SessionMember;
}

/**
 * Lets a request through only with a live session cookie, like
 * [Authorize] in ASP.NET Core. Puts the member on the request and sends
 * the cookie again, which renews its Max-Age.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token === undefined) throw new UnauthorizedException();
    const member = await findSession(this.db, token);
    if (member === null) throw new UnauthorizedException();

    request.member = member;
    http
      .getResponse<ServerResponse>()
      .setHeader("Set-Cookie", sessionCookie(token));
    return true;
  }
}

/** The member of the session, in a route behind SessionGuard. */
export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionMember => {
    const member = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().member;
    if (member === undefined) {
      throw new Error("CurrentMember used on a route without SessionGuard");
    }
    return member;
  },
);
