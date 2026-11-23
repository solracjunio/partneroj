// The app's pages, from the address bar. A few pages need no router
// library; one comes in when the app has more screens.

export type Route =
  | { page: "home" }
  | { page: "expense" }
  | { page: "feed" }
  | { page: "balances" }
  | { page: "entry"; id: string }
  | { page: "invite"; token: string }
  | { page: "members" }
  | { page: "member"; id: string }
  | { page: "not-found" };

/** The link made by admin-cli and by the app: /convite/<token>. */
const invitePath = /^\/convite\/([A-Za-z0-9_-]+)\/?$/;

/** One entry: /lancamento/<id>, the id a UUID as the API makes them. */
const entryPath =
  /^\/lancamento\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** One member, on the admin's screen: /membros/<id>, as entryPath. */
const memberPath =
  /^\/membros\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export function matchRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { page: "home" };
  if (pathname === "/gasto" || pathname === "/gasto/") {
    return { page: "expense" };
  }
  if (pathname === "/atividades" || pathname === "/atividades/") {
    return { page: "feed" };
  }
  if (pathname === "/saldos" || pathname === "/saldos/") {
    return { page: "balances" };
  }
  if (pathname === "/membros" || pathname === "/membros/") {
    return { page: "members" };
  }
  const member = memberPath.exec(pathname);
  if (member) return { page: "member", id: member[1]!.toLowerCase() };
  const entry = entryPath.exec(pathname);
  if (entry) return { page: "entry", id: entry[1]!.toLowerCase() };
  const invite = invitePath.exec(pathname);
  if (invite) return { page: "invite", token: invite[1]! };
  return { page: "not-found" };
}

/** The address of an invite, for the admin screen to share. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/convite/${token}`;
}

/** The address of a member on the "Membros" screen. */
export function memberLink(id: string): string {
  return `/membros/${id}`;
}

/** The address of an entry's screen, from the feed. */
export function entryLink(id: string): string {
  return `/lancamento/${id}`;
}

/**
 * Goes to another page without reloading. pushState doesn't tell anyone,
 * so a popstate is sent by hand: App listens to it, as it does for the
 * phone's "back".
 */
export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
