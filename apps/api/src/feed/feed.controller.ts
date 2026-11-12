import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  type Feed,
  FEED_PAGE_SIZE,
  feedQuery,
  type FeedQuery,
  markRead,
  type MarkRead,
  type UnreadCount,
} from "@partneroj/contracts";
import {
  countUnread,
  type Database,
  listFeed,
  markFeedRead,
  type SessionMember,
} from "@partneroj/db";

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

  /** The number on the home screen's "Atividades" button. */
  @Get("activities/unread")
  @Header("Cache-Control", "no-store")
  async unread(@CurrentMember() member: SessionMember): Promise<UnreadCount> {
    return {
      count: await countUnread(this.db, {
        partnershipId: member.partnershipId,
        memberId: member.memberId,
      }),
    };
  }

  /**
   * The activities the screen showed are now read by this member. Readers
   * too: it is their own mark, not a change to the partnership's data.
   */
  @Post("activities/read")
  @HttpCode(204)
  async markRead(
    @CurrentMember() member: SessionMember,
    @Body(new ZodBody(markRead)) body: MarkRead,
  ): Promise<void> {
    await markFeedRead(this.db, {
      partnershipId: member.partnershipId,
      memberId: member.memberId,
      ids: body.ids,
    });
  }
}
