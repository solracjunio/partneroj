// Calls to the API, on the same origin under /api (Caddy in production,
// the Vite proxy in development). The session cookie is HttpOnly: this
// code never sees it, the browser sends it on its own.
import type {
  CurrentProject,
  EntryDetails,
  Feed,
  MarkRead,
  NewExpense,
  ProjectBalances,
  RecordedExpense,
  RecordedReversal,
  ReverseEntryBody,
  UnreadCount,
  VapidKey,
} from "@partneroj/contracts";
import { idempotencyKeyHeader } from "@partneroj/contracts";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

export interface InvitePreview {
  memberName: string;
  partnershipName: string;
}

export interface AddedReceipt {
  id: string;
  contentType: string;
  sizeBytes: number;
}

export interface Me {
  memberId: string;
  partnershipId: string;
  name: string;
  role: "admin" | "partner" | "reader";
  /** Whether the member has a passkey: without one, the card asks. */
  hasPasskey: boolean;
}

/** A member on the admin's "Membros" screen (GET /members). */
export interface MemberAccess {
  id: string;
  name: string;
  role: Me["role"];
  /** Phones that still get in. */
  sessions: number;
  /** Passkeys not revoked. */
  passkeys: number;
  /** The latest use among those phones; null without any. */
  lastUsedAt: string | null;
  /** When the pending invite stops working; null without one. */
  inviteExpiresAt: string | null;
}

export interface NewInvite {
  token: string;
  expiresAt: string;
}

/**
 * What a call can end in, besides success. "unusable" is the API's 404
 * for an invite (used, expired, replaced or unknown alike); "signed-out"
 * is its 401; "refused" is its 403 (a reader, or a member without a
 * weight) and 422 (a project or category that is gone); "unsupported"
 * is its 413 and 415 (a file too big, or one it can't read, like HEIC);
 * "conflict" is its 409 (an entry already undone, or itself an undo);
 * "busy" is its 429 (over the limit of the routes of getting in, which
 * passes in a minute); "offline" is no answer at all.
 */
export type Failure =
  | "unusable"
  | "signed-out"
  | "refused"
  | "unsupported"
  | "conflict"
  | "busy"
  | "offline"
  | "error";

export type Result<T> =
  { ok: true; value: T } | { ok: false; failure: Failure };

async function call<T>(
  path: string,
  init: RequestInit = {},
  read: (response: Response) => Promise<T>,
): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    return { ok: false, failure: "offline" };
  }
  if (response.ok) return { ok: true, value: await read(response) };
  if (response.status === 404) return { ok: false, failure: "unusable" };
  if (response.status === 401) return { ok: false, failure: "signed-out" };
  if (response.status === 403 || response.status === 422) {
    return { ok: false, failure: "refused" };
  }
  if (response.status === 413 || response.status === 415) {
    return { ok: false, failure: "unsupported" };
  }
  if (response.status === 409) return { ok: false, failure: "conflict" };
  if (response.status === 429) return { ok: false, failure: "busy" };
  return { ok: false, failure: "error" };
}

const json = <T>(response: Response) => response.json() as Promise<T>;

export const api = {
  /** Only reads: opening the invite page uses nothing. */
  previewInvite: (token: string) =>
    call(`/invites/${encodeURIComponent(token)}`, {}, json<InvitePreview>),

  /** The tap on the button: uses the invite, the API sets the cookie. */
  acceptInvite: (token: string) =>
    call(
      `/auth/invites/${encodeURIComponent(token)}/accept`,
      { method: "POST" },
      () => Promise.resolve(undefined),
    ),

  me: () => call("/me", {}, json<Me>),

  /** "Membros": admins only, 403 otherwise. */
  members: () => call("/members", {}, json<MemberAccess[]>),

  /**
   * "Gerar convite": a new link for the member, shown once; the member's
   * pending invite stops working.
   */
  inviteMember: (memberId: string) =>
    call(
      `/members/${encodeURIComponent(memberId)}/invites`,
      { method: "POST" },
      json<NewInvite>,
    ),

  /** The project to record into and the category buttons. */
  currentProject: () => call("/projects/current", {}, json<CurrentProject>),

  /**
   * "Fiz um gasto": who paid is the session, not the body. The key is the
   * draft's: sent again after a lost answer, the server returns the expense
   * it already recorded instead of a second one.
   */
  recordExpense: (body: NewExpense, key: string) =>
    call(
      "/entries/expenses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [idempotencyKeyHeader]: key,
        },
        body: JSON.stringify(body),
      },
      json<RecordedExpense>,
    ),

  /** "Atividades": the first page, or the one after `before`. */
  feed: (before?: string) =>
    call(
      before === undefined
        ? "/activities"
        : `/activities?before=${encodeURIComponent(before)}`,
      {},
      json<Feed>,
    ),

  /** How many activities are new: the number on the home button. */
  unreadCount: () => call("/activities/unread", {}, json<UnreadCount>),

  /** "Saldos": the current project's balances, for every member. */
  balances: () => call("/projects/current/balances", {}, json<ProjectBalances>),

  /** The activities the screen showed are now read. */
  markRead: (body: MarkRead) =>
    call(
      "/activities/read",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      () => Promise.resolve(undefined),
    ),

  /** The "Lançamento" screen: one entry, its receipts and status. */
  entry: (entryId: string) =>
    call(`/entries/${encodeURIComponent(entryId)}`, {}, json<EntryDetails>),

  /** "Desfazer": only the author, with a reason (ADR 0006). */
  reverseEntry: (entryId: string, body: ReverseEntryBody) =>
    call(
      `/entries/${encodeURIComponent(entryId)}/reverse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      json<RecordedReversal>,
    ),

  /** The key to subscribe with; 503 when the server sends no pushes. */
  vapidKey: () => call("/notifications/vapid-key", {}, json<VapidKey>),

  /** "Ativar avisos": this phone's subscription, for this session. */
  saveSubscription: (subscription: PushSubscriptionJSON) =>
    call(
      "/notifications/subscription",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      },
      () => Promise.resolve(undefined),
    ),

  /** "Desligar avisos": the server stops sending to this phone. */
  removeSubscription: () =>
    call("/notifications/subscription", { method: "DELETE" }, () =>
      Promise.resolve(undefined),
    ),

  /** What the phone needs to make a passkey, with a new challenge. */
  passkeyOptions: () =>
    call(
      "/auth/passkeys/register/options",
      { method: "POST" },
      json<PublicKeyCredentialCreationOptionsJSON>,
    ),

  /** The phone's answer; 409 when the API already has that passkey. */
  registerPasskey: (answer: RegistrationResponseJSON) =>
    call(
      "/auth/passkeys/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answer),
      },
      () => Promise.resolve(undefined),
    ),

  /** What the phone needs to sign in with its passkey; no session. */
  passkeyLoginOptions: () =>
    call(
      "/auth/passkeys/login/options",
      { method: "POST" },
      json<PublicKeyCredentialRequestOptionsJSON>,
    ),

  /**
   * The phone's signed answer: the API sets the session cookie, as when
   * accepting an invite. 401 when it doesn't know the passkey.
   */
  passkeyLogin: (answer: AuthenticationResponseJSON) =>
    call(
      "/auth/passkeys/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answer),
      },
      () => Promise.resolve(undefined),
    ),

  /** The receipt of an entry: the body is the file itself. */
  addReceipt: (entryId: string, file: Blob) =>
    call(
      `/entries/${encodeURIComponent(entryId)}/receipts`,
      {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      },
      json<AddedReceipt>,
    ),
};
