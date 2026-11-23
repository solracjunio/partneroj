import { describe, expect, it } from "vitest";

import type { MemberAccess } from "./api";
import { accessLine, inviteLine, lastUseLine, roleLabel } from "./members";

const member = (more: Partial<MemberAccess> = {}): MemberAccess => ({
  id: "01a1c25b-7bf8-7cea-b37d-5194960ba9d0",
  name: "Ana",
  role: "partner",
  sessions: 0,
  passkeys: 0,
  lastUsedAt: null,
  inviteExpiresAt: null,
  ...more,
});

// Local time, as the phone shows it.
const now = new Date(2026, 10, 23, 15, 0);
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();

describe("roleLabel", () => {
  it.each([
    { role: "admin", label: "Administrador" },
    { role: "partner", label: "Sócio" },
    { role: "reader", label: "Leitor" },
  ] as const)("calls $role $label", ({ role, label }) => {
    expect(roleLabel(role)).toBe(label);
  });
});

describe("accessLine", () => {
  it("counts the phones, one or more", () => {
    expect(accessLine(member({ sessions: 1 }), now)).toBe("Entra em 1 celular");
    expect(accessLine(member({ sessions: 2 }), now)).toBe(
      "Entra em 2 celulares",
    );
  });

  it("says when the fingerprint is saved", () => {
    expect(accessLine(member({ sessions: 1, passkeys: 1 }), now)).toBe(
      "Entra em 1 celular · digital salva",
    );
  });

  it("shows a pending invite when no phone gets in", () => {
    expect(accessLine(member({ inviteExpiresAt: at(24, 9, 5) }), now)).toBe(
      "Convite enviado, vale até amanhã, 09:05",
    );
  });

  it("asks for an invite when nothing lets the member in", () => {
    expect(accessLine(member(), now)).toBe("Sem acesso: gere um convite");
    // A passkey alone, after every session ended, is not a way in the
    // admin can count on: the screen asks for an invite.
    expect(accessLine(member({ passkeys: 1 }), now)).toBe(
      "Sem acesso: gere um convite",
    );
  });
});

describe("inviteLine", () => {
  it("says until when, today or tomorrow", () => {
    expect(inviteLine(at(23, 20, 30), now)).toBe(
      "Convite enviado, vale até hoje, 20:30",
    );
    expect(inviteLine(at(24, 14), now)).toBe(
      "Convite enviado, vale até amanhã, 14:00",
    );
  });
});

describe("lastUseLine", () => {
  it("says when the member last used the app", () => {
    expect(lastUseLine(member({ lastUsedAt: at(23, 9, 54) }), now)).toBe(
      "Usou o app: Hoje, 09:54",
    );
    expect(lastUseLine(member({ lastUsedAt: at(5, 18, 2) }), now)).toBe(
      "Usou o app: 05/11/2026, 18:02",
    );
  });

  it("says nothing without a phone that gets in", () => {
    expect(lastUseLine(member(), now)).toBeNull();
  });
});
