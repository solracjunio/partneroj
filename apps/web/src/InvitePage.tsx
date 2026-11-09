import { useEffect, useState } from "react";

import { api, type Failure, type InvitePreview } from "./api";

type State =
  | { step: "loading" }
  | { step: "ready"; preview: InvitePreview; failed?: Failure }
  | { step: "entering"; preview: InvitePreview }
  | { step: "done"; preview: InvitePreview }
  | { step: "failed"; failure: Failure };

/**
 * The invite link (plan section 6). Opening it only shows who it is for;
 * the tap on the button uses it. A messenger's link preview opens the
 * address on its own and never taps.
 */
export function InvitePage({ token }: { token: string }) {
  const [state, setState] = useState<State>({ step: "loading" });

  useEffect(() => {
    let current = true;
    void api.previewInvite(token).then((result) => {
      if (!current) return;
      setState(
        result.ok
          ? { step: "ready", preview: result.value }
          : { step: "failed", failure: result.failure },
      );
    });
    return () => {
      current = false;
    };
  }, [token]);

  async function enter(preview: InvitePreview) {
    setState({ step: "entering", preview });
    const result = await api.acceptInvite(token);
    if (result.ok) {
      // The used link leaves the address bar and the history: "back"
      // won't land on an invite page that no longer works.
      window.history.replaceState(null, "", "/");
      setState({ step: "done", preview });
    } else if (result.failure === "unusable") {
      setState({ step: "failed", failure: "unusable" });
    } else {
      setState({ step: "ready", preview, failed: result.failure });
    }
  }

  switch (state.step) {
    case "loading":
      return <p className="muted">Abrindo o convite…</p>;

    case "failed":
      return <InviteProblem failure={state.failure} />;

    case "ready":
    case "entering":
      return (
        <section>
          <h1>Olá, {state.preview.memberName}.</h1>
          <p>
            Toque no botão para entrar na{" "}
            <strong>{state.preview.partnershipName}</strong>.
          </p>
          <button
            type="button"
            className="primary"
            disabled={state.step === "entering"}
            onClick={() => void enter(state.preview)}
          >
            {state.step === "entering" ? "Entrando…" : "Entrar"}
          </button>
          {state.step === "ready" && state.failed && (
            <p role="alert" className="problem">
              {state.failed === "offline"
                ? "Sem conexão. Confira a internet e toque de novo."
                : "Algo deu errado. Toque de novo daqui a pouco."}
            </p>
          )}
        </section>
      );

    case "done":
      return (
        <section>
          <h1>Pronto, {state.preview.memberName}!</h1>
          <p>Você entrou na {state.preview.partnershipName}.</p>
          <div className="notice">
            <p>
              <strong>Abra sempre por este navegador.</strong>
            </p>
            <p>
              Você entrou por este navegador, e é nele que o Partneroj se lembra
              de você. Em outro navegador, seria preciso um convite novo.
            </p>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => window.location.replace("/")}
          >
            Continuar
          </button>
        </section>
      );
  }
}

function InviteProblem({ failure }: { failure: Failure }) {
  if (failure === "offline") {
    return (
      <section>
        <h1>Sem conexão</h1>
        <p>Confira a internet e abra o link de novo.</p>
      </section>
    );
  }
  if (failure === "unusable") {
    return (
      <section>
        <h1>Este convite não vale mais</h1>
        <p>
          Ele pode já ter sido usado, ter passado de 24 horas ou ter sido
          trocado por um mais novo.
        </p>
        <p>
          <strong>Peça um convite novo a um administrador.</strong>
        </p>
      </section>
    );
  }
  return (
    <section>
      <h1>Algo deu errado</h1>
      <p>Abra o link de novo daqui a pouco.</p>
    </section>
  );
}
