import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import {
  type CurrentProject,
  type EntryDetails,
  newExpense,
  type NewExpense,
  type RecordedExpense,
  type RecordedReversal,
  reverseEntryBody,
  type ReverseEntryBody,
} from "@partneroj/contracts";
import {
  currentProject,
  type Database,
  findEntryDetails,
  ExpenseRefused,
  type PgBoss,
  recordExpense,
  ReversalRefused,
  reverseEntry,
  type SessionMember,
} from "@partneroj/db";

import { CurrentMember, SessionGuard } from "../auth/session.guard.js";
import { DATABASE } from "../database/database.module.js";
import { JOB_QUEUE } from "../jobs/jobs.module.js";
import { mayAddReceipt } from "../receipts/rules.js";
import { ZodBody } from "../validation/zod-body.pipe.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
   * The "Lançamento" screen: one entry of the member's partnership, for
   * everyone, readers included (plan section 2).
   */
  @Get("entries/:entryId")
  @Header("Cache-Control", "no-store")
  async details(
    @CurrentMember() member: SessionMember,
    @Param("entryId") entryId: string,
  ): Promise<EntryDetails> {
    const row = UUID.test(entryId)
      ? await findEntryDetails(this.db, {
          entryId,
          partnershipId: member.partnershipId,
          memberId: member.memberId,
        })
      : null;
    if (row === null) throw new NotFoundException("entry-not-found");
    return {
      id: row.id,
      type: row.type,
      amountCents: row.amount.toString(),
      occurredOn: row.occurredOn,
      category: row.category,
      description: row.description,
      paidBy: row.paidBy,
      author: row.author,
      recordedAt: row.createdAt.toISOString(),
      receipts: row.receipts,
      status: row.reversal === null ? "confirmed" : "reversed",
      reversal:
        row.reversal === null
          ? null
          : {
              id: row.reversal.id,
              reason: row.reversal.reason,
              at: row.reversal.createdAt.toISOString(),
              by: row.reversal.by,
            },
      reversalOf: row.reversalOf,
      canReverse: row.canReverse,
      canAddReceipt: mayAddReceipt(member, { authorId: row.author.id }),
    };
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

  /**
   * "Desfazer" (ADR 0006): only the author undoes their own entry, with a
   * reason. The entry stays; a reversal with the sign inverted cancels it.
   */
  @Post("entries/:entryId/reverse")
  async reverse(
    @CurrentMember() member: SessionMember,
    @Param("entryId") entryId: string,
    @Body(new ZodBody(reverseEntryBody)) body: ReverseEntryBody,
  ): Promise<RecordedReversal> {
    if (!UUID.test(entryId)) throw new NotFoundException("entry-not-found");
    try {
      const row = await reverseEntry(
        this.db,
        this.boss,
        { memberId: member.memberId, partnershipId: member.partnershipId },
        { entryId, reason: body.reason },
      );
      return {
        id: row.id,
        reversalOf: row.reversalOf!,
        amountCents: row.amount.toString(),
      };
    } catch (error) {
      if (!(error instanceof ReversalRefused)) throw error;
      switch (error.reason) {
        // Another partnership's entry looks the same as a missing one.
        case "entry-not-found":
          throw new NotFoundException(error.reason);
        case "not-author":
          throw new ForbiddenException(error.reason);
        // The entry's state forbids it: already undone, or itself an undo.
        case "already-reversed":
        case "reversal-of-reversal":
          throw new ConflictException(error.reason);
        case "reason-required":
        case "account-overdrawn":
          throw new UnprocessableEntityException(error.reason);
      }
    }
  }
}
