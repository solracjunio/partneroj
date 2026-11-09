// The app's pages, from the address bar. Two pages need no router
// library; one comes in when the app has more screens.

export type Route =
  { page: "home" } | { page: "invite"; token: string } | { page: "not-found" };

/** The link made by admin-cli and by the app: /convite/<token>. */
const invitePath = /^\/convite\/([A-Za-z0-9_-]+)\/?$/;

export function matchRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { page: "home" };
  const invite = invitePath.exec(pathname);
  if (invite) return { page: "invite", token: invite[1]! };
  return { page: "not-found" };
}

/** The address of an invite, for the admin screen to share. */
export function inviteLink(origin: string, token: string): string {
  return `${origin}/convite/${token}`;
}
