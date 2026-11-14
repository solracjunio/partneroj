import { useEffect, useState } from "react";

import { api } from "./api";
import { androidBrowser, readPush, turnOffPush, turnOnPush } from "./push";

type View =
  | { kind: "hidden" }
  | { kind: "off" | "on" | "blocked"; publicKey: string; problem?: string };

/**
 * "Ativar avisos" (plan section 4): a notification on this phone for each
 * partner's entry. Shown only where it can work: a browser with Web Push
 * and a server with a key. The feed stays the source of truth.
 */
export function NotificationsCard() {
  const [view, setView] = useState<View>({ kind: "hidden" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      const push = await readPush();
      if (push.state === "unsupported") return;
      const key = await api.vapidKey();
      if (!current || !key.ok) return;
      if (push.subscription !== null && push.state === "on") {
        // The server may know this phone under an older session (signed
        // in again): sending it moves it to this one. Only a refresh, so
        // a failure changes nothing on the screen.
        void api.saveSubscription(push.subscription.toJSON());
      }
      setView({ kind: push.state, publicKey: key.value.publicKey });
    })();
    return () => {
      current = false;
    };
  }, []);

  if (view.kind === "hidden") return null;
  const { publicKey } = view;

  async function on() {
    setBusy(true);
    const result = await turnOnPush(publicKey);
    setBusy(false);
    setView(
      result === "failed"
        ? {
            kind: "off",
            publicKey,
            problem: "Não deu para ativar os avisos. Tente de novo.",
          }
        : { kind: result, publicKey },
    );
  }

  async function off() {
    setBusy(true);
    const result = await turnOffPush();
    setBusy(false);
    setView(
      result === "failed"
        ? {
            kind: "on",
            publicKey,
            problem: "Não deu para desligar os avisos. Tente de novo.",
          }
        : { kind: "off", publicKey },
    );
  }

  const problem = view.problem !== undefined && (
    <p className="problem" role="alert">
      {view.problem}
    </p>
  );

  if (view.kind === "blocked") {
    return (
      <div className="notice">
        <p>
          <strong>Os avisos estão bloqueados neste celular.</strong>
        </p>
        <p>
          Para liberar, abra as configurações do navegador (ou do celular, se
          usa o app instalado), procure o Partneroj e permita as notificações.
        </p>
      </div>
    );
  }

  if (view.kind === "on") {
    return (
      <div className="push-on">
        <p className="muted">Avisos ligados neste celular.</p>
        <BatteryTip />
        {problem}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void off()}
        >
          Desligar avisos
        </button>
      </div>
    );
  }

  return (
    <div className="notice">
      <p>
        <strong>Receba um aviso a cada gasto dos sócios.</strong>
      </p>
      <p>Chega no celular mesmo com o app fechado.</p>
      {problem}
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => void on()}
      >
        Ativar avisos
      </button>
    </div>
  );
}

const TIP_SEEN = "partneroj.battery-tip-seen";

/** Whether "Já fiz isso" was tapped here; false when storage refuses. */
function tipSeen(): boolean {
  try {
    return localStorage.getItem(TIP_SEEN) === "yes";
  } catch {
    return false;
  }
}

/**
 * Android only: the browser's battery setting decides whether a push
 * comes at once or minutes later, and a web page cannot read it. So the
 * tip stays until "Já fiz isso"; a phone that keeps nothing (a private
 * window) just shows it again next time.
 */
function BatteryTip() {
  const [browser] = useState(androidBrowser);
  const [seen, setSeen] = useState(tipSeen);
  if (browser === null || seen) return null;

  function done() {
    setSeen(true);
    try {
      localStorage.setItem(TIP_SEEN, "yes");
    } catch {
      // Not kept: the tip comes back next time, which is harmless.
    }
  }

  return (
    <div className="notice">
      <p>
        <strong>Para os avisos chegarem na hora</strong>, mesmo com a tela
        desligada: em Configurações → Apps → {browser} → Bateria, escolha{" "}
        <strong>Sem restrições</strong>.
      </p>
      <button type="button" className="primary" onClick={done}>
        Já fiz isso
      </button>
    </div>
  );
}
