import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import {
  type CurrentProject,
  newExpense,
  type NewExpense,
  type RecordedExpense,
} from "@partneroj/contracts";
import {
  currentProject,
  type Database,
  ExpenseRefused,
  type PgBoss,
  recordExpense,
  type SessionMember,
} from "@partneroj/db";

import { CurrentMember, SessionGuard } from "../auth/session.guard.js";
import { DATABASE } from "../database/database.module.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { ZodBody } from "../validation/zod-body.pipe.js";

@Controller()
@UseGuards(SessionGuard)
export class EntriesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(JOB_QUEUE) private readonly boss: PgBoss,
  ) {}

  /** The project to record into and the "O que foi" buttons. */
  @Get("projects/current")
  @Header("Cache-Control", "no-store")
  async current(
    @CurrentMember() member: SessionMember,
  ): Promise<CurrentProject> {
    const current = await currentProject(this.db, member.partnershipId);
    if (current === null) throw new NotFoundException("no_project");
    return current;
  }

  /**
   * "Fiz um gasto": an expense paid from the signed-in member's own
   * pocket. Who paid is the session, not a field of the body.
   */
  @Post("entries/expenses")
  async recordExpense(
    @CurrentMember() member: SessionMember,
    @Body(new ZodBody(newExpense)) body: NewExpense,
  ): Promise<RecordedExpense> {
    // Plan section 2: a reader only follows.
    if (member.role === "reader") throw new ForbiddenException();
    try {
      const row = await recordExpense(
        this.db,
        this.boss,
        { memberId: member.memberId, partnershipId: member.partnershipId },
        {
          projectId: body.projectId,
          amount: BigInt(body.amountCents),
          categoryId: body.categoryId,
          occurredOn: body.occurredOn,
          description: body.description,
        },
      );
      return {
        id: row.id,
        amountCents: row.amount.toString(),
        occurredOn: row.occurredOn,
      };
    } catch (error) {
      if (!(error instanceof ExpenseRefused)) throw error;
      // A project or category of another partnership looks the same as
      // one that doesn't exist: 422, the body points at nothing usable.
      if (error.reason === "payer-without-weight") {
        throw new ForbiddenException(error.reason);
      }
      throw new UnprocessableEntityException(error.reason);
    }
  }
}
