import { useEffect, useState } from "react";

import { api, type Me, type Result } from "./api";
import { InstallCard } from "./InstallCard";
import { navigate } from "./routes";

/**
 * The first screen: who is signed in, the "Fiz um gasto" button and the
 * way to the feed. The balances come in the next PRs of block 5.
 */
export function HomePage() {
  const [me, setMe] = useState<Result<Me> | null>(null);

  useEffect(() => {
    let current = true;
    void api.me().then((result) => {
      if (current) setMe(result);
    });
    return () => {
      current = false;
    };
  }, []);

  if (me === null) return <p className="muted">Carregando…</p>;

  if (me.ok) {
    return (
      <section>
        <h1>Olá, {me.value.name}.</h1>
        <div className="actions">
          {/* Plan section 2: a reader only follows. */}
          {me.value.role !== "reader" && (
            <button
              type="button"
              className="primary"
              onClick={() => navigate("/gasto")}
            >
              Fiz um gasto
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => navigate("/atividades")}
          >
            Atividades
          </button>
        </div>
        <p className="muted">Os saldos chegam nas próximas versões.</p>
        <InstallCard />
      </section>
    );
  }

  if (me.failure === "signed-out") {
    return (
      <section>
        <h1>Partneroj</h1>
        <p>Para entrar, peça um convite a um administrador.</p>
        <p className="muted">
          Se você já entrou antes, abra o Partneroj pelo mesmo navegador daquela
          vez.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>Sem conexão</h1>
      <p>Confira a internet e abra de novo.</p>
    </section>
  );
}
