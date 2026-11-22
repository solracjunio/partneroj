import { useEffect, useState } from "react";

import {
  type PasskeyResult,
  passkeySupported,
  protectWithPasskey,
} from "./passkey";

type View = "hidden" | "offer" | "waiting" | "done" | "cancelled" | "failed";

const LATER = "partneroj.passkey-later";

/**
 * Whether "Agora não" was tapped since the app opened; false when the
 * phone keeps nothing (sessionStorage refused).
 */
function askedLater(): boolean {
  try {
    return sessionStorage.getItem(LATER) === "yes";
  } catch {
    return false;
  }
}

const viewFor: Record<PasskeyResult, View> = {
  saved: "done",
  already: "done",
  cancelled: "cancelled",
  failed: "failed",
};

/**
 * "Proteja sua conta com a digital" (plan section 6, "Passkey"), on top of
 * the home screen until the member has a passkey. "Agora não" hides it
 * until the app is opened again (decided on 2026-11-21). Not shown on a
 * phone without a fingerprint, face or screen lock.
 */
export function PasskeyCard({ hasPasskey }: { hasPasskey: boolean }) {
  const [view, setView] = useState<View>("hidden");

  useEffect(() => {
    if (hasPasskey || askedLater()) return;
    let current = true;
    void passkeySupported().then((supported) => {
      if (current && supported) setView("offer");
    });
    return () => {
      current = false;
    };
  }, [hasPasskey]);

  if (view === "hidden") return null;

  async function protect() {
    setView("waiting");
    setView(viewFor[await protectWithPasskey()]);
  }

  function later() {
    setView("hidden");
    try {
      sessionStorage.setItem(LATER, "yes");
    } catch {
      // Not kept: the card comes back on the next screen, which is harmless.
    }
  }

  if (view === "done") {
    return (
      <div className="notice">
        <p>
          <strong>Pronto: sua conta está protegida pela digital.</strong>
        </p>
      </div>
    );
  }

  if (view === "waiting") {
    return (
      <div className="notice">
        <p role="status">Aguardando a digital…</p>
      </div>
    );
  }

  return (
    <div className="notice">
      <p>
        <strong>Proteja sua conta com a digital.</strong>
      </p>
      <p>
        Se o app pedir para entrar de novo, você usa a digital, sem precisar de
        convite.
      </p>
      {view === "cancelled" && (
        <p className="muted" role="status">
          Cadastro cancelado. Tente de novo quando quiser.
        </p>
      )}
      {view === "failed" && (
        <p className="problem" role="alert">
          Não deu para cadastrar a digital. Tente de novo.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => void protect()}
        >
          Cadastrar digital
        </button>
        <button type="button" className="secondary" onClick={later}>
          Agora não
        </button>
      </div>
    </div>
  );
}
