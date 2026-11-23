// The words of the "Membros" screen (plan section 5, "Administração"):
// plain sentences about who gets in, built from GET /members.
import type { MemberAccess } from "./api";
import { formatWhen } from "./feed";

export function roleLabel(role: MemberAccess["role"]): string {
  if (role === "admin") return "Administrador";
  if (role === "partner") return "Sócio";
  return "Leitor";
}

/**
 * One line under the name. Phones first, as that is what gets in; then a
 * pending invite; otherwise what to do. Example: "Entra em 2 celulares ·
 * digital salva".
 */
export function accessLine(member: MemberAccess, now: Date): string {
  if (member.sessions > 0) {
    const phones =
      member.sessions === 1 ? "1 celular" : `${member.sessions} celulares`;
    const fingerprint = member.passkeys > 0 ? " · digital salva" : "";
    return `Entra em ${phones}${fingerprint}`;
  }
  if (member.inviteExpiresAt !== null) {
    return inviteLine(member.inviteExpiresAt, now);
  }
  return "Sem acesso: gere um convite";
}

/**
 * "Convite enviado, vale até amanhã, 09:05". An invite lasts 24 hours,
 * and the API lists only one not expired: it ends today or tomorrow.
 */
export function inviteLine(expiresAt: string, now: Date): string {
  const when =
    tomorrow(expiresAt, now) ??
    formatWhen(expiresAt, now).replace(/^Hoje/, "hoje");
  return `Convite enviado, vale até ${when}`;
}

/** "amanhã, 14:00" when the time is tomorrow, in the phone's own time. */
function tomorrow(at: string, now: Date): string | null {
  const when = new Date(at);
  const next = new Date(now);
  next.setDate(now.getDate() + 1);
  if (when.toDateString() !== next.toDateString()) return null;
  const time = formatWhen(at, when).replace(/^Hoje, /, "");
  return `amanhã, ${time}`;
}

/** "Usou o app: Hoje, 09:54"; null without a phone that gets in. */
export function lastUseLine(member: MemberAccess, now: Date): string | null {
  if (member.lastUsedAt === null) return null;
  return `Usou o app: ${formatWhen(member.lastUsedAt, now)}`;
}
