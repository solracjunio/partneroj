import { useEffect, useState } from "react";

import { api, type Failure, type MemberAccess, type NewInvite } from "./api";
import { accessLine, inviteLine, lastUseLine, roleLabel } from "./members";
import { ChangeRole } from "./ChangeRole";
import { RevokeAccess } from "./RevokeAccess";
import { inviteLink, memberLink } from "./routes";

const loadProblemText: Record<Failure, string> = {
  refused: "Só administradores veem os membros.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  offline: "Sem conexão. Confira a internet e toque em Tentar de novo.",
  busy: "Muitas tentativas. Espere um minuto e toque em Tentar de novo.",
  error: "Algo deu errado. Toque em Tentar de novo.",
  unusable: "Algo deu errado. Toque em Tentar de novo.",
  unsupported: "Algo deu errado. Toque em Tentar de novo.",
  conflict: "Algo deu errado. Toque em Tentar de novo.",
};

const inviteProblemText: Record<Failure, string> = {
  offline: "Sem conexão. Confira a internet e toque em Gerar convite de novo.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  refused: "Só administradores geram convites.",
  unusable: "Este membro não está mais na sociedade.",
  busy: "Muitas tentativas. Espere um minuto e tente de novo.",
  error: "Algo deu errado. Toque em Gerar convite de novo.",
  unsupported: "Algo deu errado. Toque em Gerar convite de novo.",
  conflict: "Algo deu errado. Toque em Gerar convite de novo.",
};

/** Loads GET /members, with "Tentar de novo" on a failure that may pass. */
function useMembers() {
  const [members, setMembers] = useState<MemberAccess[] | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);

  async function load() {
    setProblem(null);
    const found = await api.members();
    if (!found.ok) return setProblem(found.failure);
    setMembers(found.value);
  }

  useEffect(() => {
    void load();
    // Only once, on opening the screen.
  }, []);

  return { members, setMembers, problem, load };
}

function LoadProblem({
  problem,
  onRetry,
}: {
  problem: Failure;
  onRetry: () => void;
}) {
  return (
    <div className="actions">
      <p role="alert" className="problem">
        {loadProblemText[problem]}
      </p>
      {(problem === "offline" || problem === "error") && (
        <button type="button" className="secondary" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

/**
 * "Membros" (plan section 5, "Administração"): who is in the partnership
 * and whether each one gets in. Admins only; a tap opens the member.
 */
export function MembersPage() {
  const { members, problem, load } = useMembers();
  const now = new Date();
  const back = (
    <p>
      <a href="/">← Voltar ao início</a>
    </p>
  );

  if (problem !== null) {
    return (
      <section>
        {back}
        <h1>Membros</h1>
        <LoadProblem problem={problem} onRetry={() => void load()} />
      </section>
    );
  }
  if (members === null) {
    return (
      <section>
        {back}
        <h1>Membros</h1>
        <p className="muted">Carregando…</p>
      </section>
    );
  }
  return (
    <section>
      {back}
      <h1>Membros</h1>
      <ul className="balances">
        {members.map((m) => (
          <li key={m.id}>
            <p className="balances-name">
              <a className="entry-link" href={memberLink(m.id)}>
                {m.name} ▸
              </a>
            </p>
            <p className="muted">{roleLabel(m.role)}</p>
            <p>{accessLine(m, now)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

type InviteState =
  | { step: "idle" }
  | { step: "sending" }
  | { step: "made"; invite: NewInvite; copied: boolean }
  | { step: "failed"; failure: Failure };

/**
 * One member: their phones, fingerprint, last use and invite, and
 * "Gerar convite". The link is shown once, to copy or share; the API
 * keeps only its hash.
 */
export function MemberPage({ id }: { id: string }) {
  const { members, setMembers, problem, load } = useMembers();
  const [invite, setInvite] = useState<InviteState>({ step: "idle" });
  // Who is looking (AdminActions).
  const [meId, setMeId] = useState<string | null>(null);
  // An admin who stepped down sees no admin screen: every button on it
  // would answer 403.
  const [steppedDown, setSteppedDown] = useState(false);

  useEffect(() => {
    let current = true;
    void api.me().then((result) => {
      if (current && result.ok) setMeId(result.value.memberId);
    });
    return () => {
      current = false;
    };
  }, []);
  const now = new Date();
  const back = (
    <p>
      <a href="/membros">← Voltar aos membros</a>
    </p>
  );

  if (problem !== null) {
    return (
      <section>
        {back}
        <h1>Membro</h1>
        <LoadProblem problem={problem} onRetry={() => void load()} />
      </section>
    );
  }
  if (members === null) {
    return (
      <section>
        {back}
        <h1>Membro</h1>
        <p className="muted">Carregando…</p>
      </section>
    );
  }
  // A name for the loaded list: makeInvite, declared below, can't see that
  // members is no longer null.
  const loaded = members;
  const member = loaded.find((m) => m.id === id);
  if (member === undefined) {
    return (
      <section>
        {back}
        <h1>Membro não encontrado</h1>
        <p>Este membro não está na sociedade.</p>
      </section>
    );
  }

  async function makeInvite() {
    setInvite({ step: "sending" });
    const made = await api.inviteMember(id);
    if (!made.ok) return setInvite({ step: "failed", failure: made.failure });
    setInvite({ step: "made", invite: made.value, copied: false });
    // The new link replaced the old one: the line shows the new end.
    setMembers(
      loaded.map((m) =>
        m.id === id ? { ...m, inviteExpiresAt: made.value.expiresAt } : m,
      ),
    );
  }

  function revoked() {
    // Nothing lets the member in now, and a link on the screen was revoked
    // with the rest: it goes away, and "Gerar convite" comes back.
    setInvite({ step: "idle" });
    setMembers(
      loaded.map((m) =>
        m.id === id
          ? {
              ...m,
              sessions: 0,
              passkeys: 0,
              lastUsedAt: null,
              inviteExpiresAt: null,
            }
          : m,
      ),
    );
  }

  if (steppedDown) {
    return (
      <section>
        <p role="status" className="notice">
          Você deixou de ser administrador. Agora o seu papel é Sócio.
        </p>
        <p>
          <a href="/">← Voltar ao início</a>
        </p>
      </section>
    );
  }

  function roleChanged(role: MemberAccess["role"]) {
    // Only an admin opens this screen: their own change is stepping down.
    if (id === meId) return setSteppedDown(true);
    setMembers(loaded.map((m) => (m.id === id ? { ...m, role } : m)));
  }

  const lastUse = lastUseLine(member, now);
  return (
    <section>
      {back}
      <h1>{member.name}</h1>
      <p className="muted">{roleLabel(member.role)}</p>
      <p>{accessLine(member, now)}</p>
      {lastUse !== null && <p>{lastUse}</p>}
      {member.sessions > 0 && member.inviteExpiresAt !== null && (
        <p>{inviteLine(member.inviteExpiresAt, now)}</p>
      )}

      {invite.step === "made" ? (
        <InviteLink
          name={member.name}
          link={inviteLink(window.location.origin, invite.invite.token)}
          copied={invite.copied}
          onCopied={() => setInvite({ ...invite, copied: true })}
        />
      ) : (
        <div className="actions">
          <p>
            Um convite novo serve para entrar num celular novo. O convite
            anterior deixa de valer.
          </p>
          <button
            type="button"
            className="primary"
            disabled={invite.step === "sending"}
            onClick={() => void makeInvite()}
          >
            {invite.step === "sending" ? "Gerando…" : "Gerar convite"}
          </button>
          {invite.step === "failed" && (
            <p role="alert" className="problem">
              {inviteProblemText[invite.failure]}
            </p>
          )}
        </div>
      )}

      <AdminActions
        member={member}
        meId={meId}
        admins={loaded.filter((m) => m.role === "admin").length}
        onRoleChanged={roleChanged}
        onRevoked={revoked}
      />
    </section>
  );
}

/**
 * The role and "Revogar acesso", once the screen knows who is looking:
 * an admin doesn't revoke their own access, and their own role change is
 * stepping down. Until /me answers, or if it fails, neither.
 */
function AdminActions({
  member,
  meId,
  admins,
  onRoleChanged,
  onRevoked,
}: {
  member: MemberAccess;
  meId: string | null;
  admins: number;
  onRoleChanged: (role: MemberAccess["role"]) => void;
  onRevoked: () => void;
}) {
  if (meId === null) return null;
  return (
    <>
      <ChangeRole
        memberId={member.id}
        name={member.name}
        role={member.role}
        isMe={meId === member.id}
        admins={admins}
        onChanged={onRoleChanged}
      />
      {meId !== member.id && (
        <RevokeAccess
          memberId={member.id}
          name={member.name}
          canRevoke={
            member.sessions > 0 ||
            member.passkeys > 0 ||
            member.inviteExpiresAt !== null
          }
          onRevoked={onRevoked}
        />
      )}
    </>
  );
}

/** The new link, once: to copy, or to send by the phone's share sheet. */
function InviteLink({
  name,
  link,
  copied,
  onCopied,
}: {
  name: string;
  link: string;
  copied: boolean;
  onCopied: () => void;
}) {
  const canShare = typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      onCopied();
    } catch {
      // No clipboard (an old browser, or no permission): the link is on
      // the screen to select by hand.
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "Convite do Partneroj",
        text: "Toque no link para entrar no Partneroj.",
        url: link,
      });
    } catch {
      // Closing the share sheet rejects too; nothing to tell.
    }
  }

  return (
    <div className="notice">
      <p>Convite para {name}:</p>
      <p className="invite-link">{link}</p>
      <p>Vale por 24 horas e só funciona uma vez. Mande só para {name}.</p>
      <div className="actions">
        {canShare && (
          <button
            type="button"
            className="primary"
            onClick={() => void share()}
          >
            Compartilhar
          </button>
        )}
        <button
          type="button"
          className={canShare ? "secondary" : "primary"}
          onClick={() => void copy()}
        >
          Copiar link
        </button>
        {copied && <p role="status">Link copiado.</p>}
      </div>
    </div>
  );
}
