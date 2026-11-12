import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type Feed,
  FEED_PAGE_SIZE,
  feedQuery,
  type FeedQuery,
} from "@partneroj/contracts";
import { type Database, listFeed, type SessionMember } from "@partneroj/db";

import { CurrentMember, SessionGuard } from "../auth/session.guard.js";
import { DATABASE } from "../database/database.module.js";
import { ZodBody } from "../validation/zod-body.pipe.js";

@Controller()
@UseGuards(SessionGuard)
export class FeedController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * "Atividades": the member's partnership, newest first. Everyone sees
   * everything, readers included (plan section 2).
   */
  @Get("activities")
  @Header("Cache-Control", "no-store")
  async list(
    @CurrentMember() member: SessionMember,
    @Query(new ZodBody(feedQuery)) query: FeedQuery,
  ): Promise<Feed> {
    const page = await listFeed(this.db, {
      partnershipId: member.partnershipId,
      memberId: member.memberId,
      before: query.before,
      limit: FEED_PAGE_SIZE,
    });
    return {
      items: page.rows.map((row) => ({
        id: row.id,
        action: row.action,
        at: row.createdAt.toISOString(),
        actor: row.actor,
        unread: row.unread,
        entry:
          row.entry === null
            ? null
            : {
                id: row.entry.id,
                type: row.entry.type,
                amountCents: row.entry.amount.toString(),
                occurredOn: row.entry.occurredOn,
                category: row.entry.category,
                description: row.entry.description,
                reversalOf: row.entry.reversalOf,
                reversalReason: row.entry.reversalReason,
                reversedBy: row.entry.reversedBy,
                receipts: row.entry.receipts,
              },
      })),
      next: page.next,
    };
  }
}
