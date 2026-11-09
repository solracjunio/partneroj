import { describe, expect, it } from "vitest";

import { describeDevice } from "./device.js";

describe("describeDevice", () => {
  it.each([
    [
      "Samsung Internet on Android",
      "Mozilla/5.0 (Linux; Android 15; SM-A556E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      { device: "Android", browser: "Samsung Internet" },
    ],
    [
      "Chrome on Android",
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
      { device: "Android", browser: "Chrome" },
    ],
    [
      "Safari on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      { device: "iOS", browser: "Safari" },
    ],
    [
      "Edge on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
      { device: "Windows", browser: "Edge" },
    ],
    [
      "Firefox on Linux",
      "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
      { device: "Linux", browser: "Firefox" },
    ],
  ])("tells %s", (_name, userAgent, expected) => {
    expect(describeDevice(userAgent)).toEqual(expected);
  });

  it("leaves out what it doesn't know", () => {
    expect(describeDevice("curl/8.0")).toEqual({
      device: undefined,
      browser: undefined,
    });
    expect(describeDevice(undefined)).toEqual({});
  });
});
