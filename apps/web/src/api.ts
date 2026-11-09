// Calls to the API, on the same origin under /api (Caddy in production,
// the Vite proxy in development). The session cookie is HttpOnly: this
// code never sees it, the browser sends it on its own.

export interface InvitePreview {
  memberName: string;
  partnershipName: string;
}

export interface Me {
  memberId: string;
  partnershipId: string;
  name: string;
  role: "admin" | "partner" | "reader";
}

/**
 * What a call can end in, besides success. "unusable" is the API's 404
 * for an invite (used, expired, replaced or unknown alike); "signed-out"
 * is its 401; "offline" is no answer at all.
 */
export type Failure = "unusable" | "signed-out" | "offline" | "error";

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
};
