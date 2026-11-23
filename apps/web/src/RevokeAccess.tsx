import { useState } from "react";

import { api, type Failure, type RevokedAccess } from "./api";

const revokeProblemText: Record<Failure, string> = {
  conflict:
    "Você não pode revogar o seu próprio acesso. Peça a outro administrador.",
  unusable: "Este membro não está mais na sociedade.",
  refused: "Só administradores revogam acessos.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  offline: "Sem conexão. Confira a internet e toque em Revogar de novo.",
  busy: "Muitas tentativas. Espere um minuto e tente de novo.",
  error: "Algo deu errado. Toque em Revogar de novo.",
  unsupported: "Algo deu errado. Toque em Revogar de novo.",
};

type Revoke =
  | { step: "closed" }
  | { step: "asking" }
  | { step: "sending" }
  | { step: "done" }
  | { step: "failed"; failure: Failure };

/**
 * "Revogar acesso" (plan section 2, after a lost phone), in two taps: one
 * to ask, one to confirm. Rendered also when nothing is left to revoke,
 * so "Acesso revogado." still shows after the member's line changes.
 */
export function RevokeAccess({
  memberId,
  name,
  canRevoke,
  onRevoked,
}: {
  memberId: string;
  name: string;
  /** Whether a phone, a passkey or an invite still lets the member in. */
  canRevoke: boolean;
  onRevoked: (revoked: RevokedAccess) => void;
}) {
  const [revoke, setRevoke] = useState<Revoke>({ step: "closed" });

  async function confirm() {
    setRevoke({ step: "sending" });
    const result = await api.revokeAccess(memberId);
    if (!result.ok) {
      return setRevoke({ step: "failed", failure: result.failure });
    }
    setRevoke({ step: "done" });
    onRevoked(result.value);
  }

  if (revoke.step === "done") {
    return (
      <p role="status" className="notice">
        Acesso revogado. {name} saiu de todos os celulares, e a digital e o
        convite deixaram de valer. Para {name} voltar, gere um convite novo.
      </p>
    );
  }
  if (!canRevoke) return null;

  if (revoke.step === "asking" || revoke.step === "sending") {
    return (
      <div className="notice">
        <p>
          Revogar o acesso de {name}? {name} sai de todos os celulares, e a
          digital e o convite deixam de valer. Para voltar, precisa de um
          convite novo.
        </p>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={revoke.step === "sending"}
            onClick={() => void confirm()}
          >
            {revoke.step === "sending" ? "Revogando…" : "Sim, revogar"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={revoke.step === "sending"}
            onClick={() => setRevoke({ step: "closed" })}
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="actions">
      <p className="muted">
        Perdeu o celular? Revogue o acesso e depois gere um convite novo.
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => setRevoke({ step: "asking" })}
      >
        Revogar acesso
      </button>
      {revoke.step === "failed" && (
        <p role="alert" className="problem">
          {revokeProblemText[revoke.failure]}
        </p>
      )}
    </div>
  );
}
