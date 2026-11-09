import { askToInstall, useInstallState } from "./install";

/**
 * "Abra sempre por este ícone" (plan section 6). The session lives in the
 * browser the invite was opened in, and an app installed from it shares
 * that session: installing from this same browser keeps the partner in.
 */
export function InstallCard() {
  const state = useInstallState();

  if (state === "in-app") return null;

  if (state === "installed") {
    return (
      <div className="notice">
        <p>
          <strong>Pronto, o app está instalado.</strong>
        </p>
        <p>
          Procure o ícone do Partneroj na tela inicial e abra sempre por ele.
        </p>
      </div>
    );
  }

  return (
    <div className="notice">
      <p>
        <strong>Instale o app e abra sempre pelo ícone.</strong>
      </p>
      {state === "can-prompt" ? (
        <>
          <p>Assim você não precisa de outro convite.</p>
          <button
            type="button"
            className="primary"
            onClick={() => void askToInstall()}
          >
            Instalar o app
          </button>
        </>
      ) : (
        <p>
          No menu do navegador (⋮), toque em <strong>Instalar app</strong> ou{" "}
          <strong>Adicionar à tela inicial</strong>.
        </p>
      )}
      <p className="muted">
        Instale por este mesmo navegador: é nele que o Partneroj se lembra de
        você.
      </p>
    </div>
  );
}
