import { useEffect, useState } from "react";

import { api, type Me, type Result } from "./api";

/**
 * The first screen. For now it only says who is signed in: the balances
 * and the "Lancei um gasto" button come in the next PRs of block 5.
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
        <p className="muted">
          Os lançamentos e os saldos chegam nas próximas versões.
        </p>
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
