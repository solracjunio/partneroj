import { describe, expect, it } from "vitest";

import { decideInstallState } from "./install";

const none = { standalone: false, installed: false, canPrompt: false };

describe("decideInstallState", () => {
  it("shows nothing inside the installed app", () => {
    expect(
      decideInstallState({ ...none, standalone: true, canPrompt: true }),
    ).toBe("in-app");
  });

  it("confirms right after installing", () => {
    expect(decideInstallState({ ...none, installed: true })).toBe("installed");
  });

  it("offers the button when the browser allows asking", () => {
    expect(decideInstallState({ ...none, canPrompt: true })).toBe("can-prompt");
  });

  it("explains the browser's menu otherwise", () => {
    expect(decideInstallState(none)).toBe("manual");
  });
});
