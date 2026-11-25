import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { roleChangeBody, type RoleChangeBody } from "@partneroj/contracts";
import { changeRole, type Database, type SessionMember } from "@partneroj/db";

import { DATABASE } from "../database/database.module.js";
import { isUuid } from "../validation/uuid.js";
import { ZodBody } from "../validation/zod-body.pipe.js";
import { CurrentMember, SessionGuard } from "./session.guard.js";

@Controller()
@UseGuards(SessionGuard)
export class RolesController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Partner ↔ admin (plan section 2): admins only, an admin alone, their
   * own role too. A partnership keeps at least 2 admins; a reader's role
   * takes a ballot. The same role again changes nothing, so a double tap
   * is not an error.
   */
  @Post("members/:memberId/role")
  @HttpCode(204)
  async change(
    @CurrentMember() actor: SessionMember,
    @Param("memberId") memberId: string,
    @Body(new ZodBody(roleChangeBody)) body: RoleChangeBody,
  ): Promise<void> {
    // changeRole refuses a non-admin too; checking here first, as every
    // admin route does, answers a partner 403 for any id, a malformed one
    // included.
    if (actor.role !== "admin") throw new ForbiddenException();
    const result = isUuid(memberId)
      ? await changeRole(this.db, {
          actorId: actor.memberId,
          partnershipId: actor.partnershipId,
          memberId,
          role: body.role,
        })
      : null;
    // "changed" and "unchanged" answer 204.
    switch (result) {
      case null:
        throw new NotFoundException();
      // Demoted by another admin while this waited on the lock.
      case "not-admin":
        throw new ForbiddenException();
      case "reader":
        throw new ConflictException("role_needs_ballot");
      case "too-few-admins":
        throw new ConflictException("too_few_admins");
    }
  }
}
