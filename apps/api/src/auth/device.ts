// The device and browser of a session, from the User-Agent, so an admin
// can tell "Android, Samsung Internet" from "Windows, Chrome" when
// revoking. A hint for people, never used for security: a User-Agent is
// whatever the client says.
import type { Device } from "@partneroj/db";

/** First match wins, so the more specific names come first. */
const systems: [RegExp, string][] = [
  [/Android/, "Android"], // Android user agents also say "Linux".
  [/iPhone|iPad/, "iOS"], // iOS user agents also say "Mac OS X".
  [/Windows/, "Windows"],
  [/Mac OS X/, "Mac"],
  [/Linux/, "Linux"],
];

const browsers: [RegExp, string][] = [
  // Samsung Internet, Edge and Opera are built on Chrome and say "Chrome"
  // too. Brave says only "Chrome": it can't be told apart.
  [/SamsungBrowser\//, "Samsung Internet"],
  [/EdgA?\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Firefox\//, "Firefox"],
  [/Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

export function describeDevice(userAgent: string | undefined): Device {
  if (userAgent === undefined) return {};
  const match = (list: [RegExp, string][]) =>
    list.find(([pattern]) => pattern.test(userAgent))?.[1];
  return { device: match(systems), browser: match(browsers) };
}
