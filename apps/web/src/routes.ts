// The app's pages, from the address bar. A few pages need no router
// library; one comes in when the app has more screens.

export type Route =
  | { page: "home" }
  | { page: "expense" }
  | { page: "invite"; token: string }
  | { page: "not-found" };

/** The link made by admin-cli and by the app: /convite/<token>. */
const invitePath = /^\/convite\/([A-Za-z0-9_-]+)\/?$/;

export function matchRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { page: "home" };
  if (pathname === "/gasto" || pathname === "/gasto/") {
    return { page: "expense" };
  }
  const invite = invitePath.exec(pathname);
  if (invite) return { page: "invite", token: invite[1]! };
  return { page: "not-found" };
}

/** The address of an invite, for the admin screen to share. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/convite/${token}`;
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
