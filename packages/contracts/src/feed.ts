// The "Atividades" feed (plan section 4): everything that happened in the
// partnership, newest first. It is the source of truth when a push is lost.
import { z } from "zod";

/** The page after this one starts before this activity id. */
export const feedQuery = z.object({
  before: z.uuid().optional(),
});

export type FeedQuery = z.infer<typeof feedQuery>;

/** How many activities a page brings. */
export const FEED_PAGE_SIZE = 30;

export type FeedAction = "entry_recorded" | "entry_reversed" | "member_joined";

/** The entry an activity is about, with its derived status (ADR 0006). */
export interface FeedEntry {
  id: string;
  type: string;
  /** Cents as a string; negative on a reversal (ADR 0005, ADR 0006). */
  amountCents: string;
  occurredOn: string;
  category: string | null;
  description: string | null;
  /** On a reversal: the entry it undoes, and why. */
  reversalOf: string | null;
  reversalReason: string | null;
  /** On an entry that was undone: the reversal's id. Null otherwise. */
  reversedBy: string | null;
  receipts: { id: string; contentType: string }[];
}

export interface FeedItem {
  /** The activity's id, also the cursor for the next page. */
  id: string;
  action: FeedAction;
  /** When it happened, as an ISO timestamp. */
  at: string;
  actor: { id: string; name: string };
  /** Not read yet by whoever asks; one's own activities are never unread. */
  unread: boolean;
  /** Null for member_joined. */
  entry: FeedEntry | null;
}

export interface Feed {
  items: FeedItem[];
  /** The `before` of the next page, or null on the last one. */
  next: string | null;
}

/** The activities shown on the screen, to mark as read (one page at most). */
export const markRead = z.object({
  ids: z.array(z.uuid()).min(1).max(FEED_PAGE_SIZE),
});

export type MarkRead = z.infer<typeof markRead>;

/** How many activities are new to whoever asks. */
export interface UnreadCount {
  count: number;
}
