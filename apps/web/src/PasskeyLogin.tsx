import { useState } from "react";

import {
  canSignInWithPasskey,
  enterWithPasskey,
  type PasskeyLoginResult,
} from "./passkey";

type View = "ready" | "waiting" | Exclude<PasskeyLoginResult, "in">;

const problemText: Record<Exclude<View, "ready" | "waiting">, string> = {
  unknown:
    "Esta digital não está cadastrada no Partneroj. Peça um convite a um administrador.",
  cancelled: "Entrada cancelada. Tente de novo quando quiser.",
  busy: "Muitas tentativas. Espere um minuto e tente de novo.",
  failed: "Não deu para entrar com a digital. Tente de novo.",
};

/**
 * "Entrar com a digital" (plan section 6, "Passkey"), on the screen
 * without a session: the passkey made with "Proteja sua conta" lets the
 * member back in without an invite. Not shown without WebAuthn.
 */
export function PasskeyLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [supported] = useState(canSignInWithPasskey);
  const [view, setView] = useState<View>("ready");
  if (!supported) return null;

  async function enter() {
    setView("waiting");
    const result = await enterWithPasskey();
    if (result === "in") return onSignedIn();
    setView(result);
  }

  if (view === "waiting") {
    return (
      <div className="actions">
        <p role="status">Aguardando a digital…</p>
      </div>
    );
  }

  return (
    <div className="actions">
      <p>Se você cadastrou a digital, entre com ela.</p>
      {view !== "ready" && (
        <p
          className={view === "cancelled" ? "muted" : "problem"}
          role={view === "cancelled" ? "status" : "alert"}
        >
          {problemText[view]}
        </p>
      )}
      <button type="button" className="primary" onClick={() => void enter()}>
        Entrar com a digital
      </button>
    </div>
  );
}
