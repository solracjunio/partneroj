import { useState } from "react";

import { api, type Failure, type MemberAccess } from "./api";
import { roleLabel } from "./members";

/** The API's minimum (MIN_ADMINS); here only to say why, it decides. */
const MIN_ADMINS = 2;

const problemText: Record<Failure, string> = {
  // The screen offers no change that leaves fewer than 2 admins, so a 409
  // means another admin changed a role first.
  conflict: "A sociedade precisa de pelo menos 2 administradores.",
  unusable: "Este membro não está mais na sociedade.",
  refused: "Só administradores mudam papéis.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  offline: "Sem conexão. Confira a internet e toque de novo.",
  busy: "Muitas tentativas. Espere um minuto e tente de novo.",
  error: "Algo deu errado. Toque de novo.",
  unsupported: "Algo deu errado. Toque de novo.",
};

type Change =
  | { step: "closed"; said: string | null }
  | { step: "asking" }
  | { step: "sending" }
  | { step: "failed"; failure: Failure };

/** The words for one change: the button, the question, the confirmation. */
interface Offer {
  role: "admin" | "partner";
  button: string;
  question: string;
  confirm: string;
}

function offerFor(
  name: string,
  role: "admin" | "partner",
  isMe: boolean,
): Offer {
  if (role === "partner") {
    return {
      role: "admin",
      button: "Tornar administrador",
      question: `Tornar ${name} administrador? ${name} vai poder gerar convites, cuidar de contas e categorias e fechar períodos.`,
      confirm: "Sim, tornar administrador",
    };
  }
  return isMe
    ? {
        role: "partner",
        button: "Deixar de ser administrador",
        question:
          "Deixar de ser administrador? Você continua votando, com o papel de Sócio, mas não vê mais Membros e convites.",
        confirm: "Sim, deixar",
      }
    : {
        role: "partner",
        button: "Tirar de administrador",
        question: `Tirar ${name} de administrador? ${name} continua votando, com o papel de Sócio.`,
        confirm: "Sim, tirar",
      };
}

/**
 * Partner ↔ admin (plan section 2), in two taps, as "Revogar acesso".
 * A reader's role takes a ballot; with only 2 admins, a sentence says
 * why an admin can't be taken out. The page updates the list on success.
 */
export function ChangeRole({
  memberId,
  name,
  role,
  isMe,
  admins,
  onChanged,
}: {
  memberId: string;
  name: string;
  role: MemberAccess["role"];
  /** Whether the member is who is looking. */
  isMe: boolean;
  /** How many admins the partnership has now. */
  admins: number;
  onChanged: (role: "admin" | "partner") => void;
}) {
  const [change, setChange] = useState<Change>({ step: "closed", said: null });

  if (role === "reader") {
    return (
      <p className="muted">
        Um leitor vira sócio por votação de todos os sócios.
      </p>
    );
  }
  if (role === "admin" && admins <= MIN_ADMINS) {
    const whom = isMe ? "deixar de ser" : `tirar ${name}`;
    return (
      <p className="muted">
        A sociedade precisa de pelo menos 2 administradores. Para {whom}, torne
        outro sócio administrador antes.
      </p>
    );
  }
  const offer = offerFor(name, role, isMe);

  async function confirm() {
    setChange({ step: "sending" });
    const result = await api.changeRole(memberId, offer.role);
    if (!result.ok) {
      return setChange({ step: "failed", failure: result.failure });
    }
    setChange({
      step: "closed",
      said: `O papel de ${name} agora é ${roleLabel(offer.role)}.`,
    });
    onChanged(offer.role);
  }

  if (change.step === "asking" || change.step === "sending") {
    return (
      <div className="notice">
        <p>{offer.question}</p>
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={change.step === "sending"}
            onClick={() => void confirm()}
          >
            {change.step === "sending" ? "Mudando…" : offer.confirm}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={change.step === "sending"}
            onClick={() => setChange({ step: "closed", said: null })}
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="actions">
      {change.step === "closed" && change.said !== null && (
        <p role="status" className="notice">
          {change.said}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        onClick={() => setChange({ step: "asking" })}
      >
        {offer.button}
      </button>
      {change.step === "failed" && (
        <p role="alert" className="problem">
          {problemText[change.failure]}
        </p>
      )}
    </div>
  );
}
