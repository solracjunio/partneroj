import type { ProjectBalances } from "@partneroj/contracts";
import { useEffect, useState } from "react";

import { api, type Failure, type Me } from "./api";
import { averageCents, signedReais } from "./balances";
import { formatCents } from "./money";

const loadProblemText: Record<Failure, string> = {
  unusable: "Ainda não há um projeto aberto.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  offline: "Sem conexão. Confira a internet e toque em Tentar de novo.",
  busy: "Muitas tentativas. Espere um minuto e toque em Tentar de novo.",
  error: "Algo deu errado. Toque em Tentar de novo.",
  refused: "Algo deu errado. Toque em Tentar de novo.",
  unsupported: "Algo deu errado. Toque em Tentar de novo.",
  conflict: "Algo deu errado. Toque em Tentar de novo.",
};

/**
 * "Saldos" (plan section 5): how much each partner put in and their
 * balance, the accounts if there are any, and what a balance means.
 */
export function BalancesPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [balances, setBalances] = useState<ProjectBalances | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);

  async function load() {
    setProblem(null);
    const [who, found] = await Promise.all([api.me(), api.balances()]);
    if (!who.ok) return setProblem(who.failure);
    if (!found.ok) return setProblem(found.failure);
    setMe(who.value);
    setBalances(found.value);
  }

  useEffect(() => {
    void load();
    // Only once, on opening the screen.
  }, []);

  const back = (
    <p>
      <a href="/">← Voltar ao início</a>
    </p>
  );

  if (problem !== null) {
    return (
      <section>
        {back}
        <h1>Saldos</h1>
        <div className="actions">
          <p role="alert" className="problem">
            {loadProblemText[problem]}
          </p>
          {(problem === "offline" || problem === "error") && (
            <button
              type="button"
              className="secondary"
              onClick={() => void load()}
            >
              Tentar de novo
            </button>
          )}
        </div>
      </section>
    );
  }

  if (me === null || balances === null) {
    return (
      <section>
        {back}
        <h1>Saldos</h1>
        <p className="muted">Carregando…</p>
      </section>
    );
  }

  return (
    <section>
      {back}
      <h1>Saldos · {balances.project.name}</h1>

      <h2>Quanto cada um já colocou</h2>
      <ul className="balances">
        {balances.partners.map((p) => (
          <li key={p.memberId}>
            <p className="balances-name">
              {p.name}
              {p.memberId === me.memberId && " (você)"}
            </p>
            <p>R$ {formatCents(p.contributedCents)}</p>
            <p>saldo {signedReais(p.balanceCents)}</p>
            {!balances.sameWeights && (
              <p className="muted">
                parte pela cota: R$ {formatCents(p.fairShareCents)}
              </p>
            )}
          </li>
        ))}
      </ul>
      {balances.sameWeights && (
        <p>Média de cada um: R$ {formatCents(averageCents(balances))}</p>
      )}

      <h2>O que é o saldo?</h2>
      <p>
        Positivo: colocou mais que a sua parte e recebe a diferença no acerto.
      </p>
      <p>Negativo: colocou menos e completa a diferença no acerto.</p>
      {/* The golden rule: without an account, the balances add up to zero. */}
      {balances.accounts.length === 0 && (
        <p>Somando todos, os saldos dão zero.</p>
      )}

      {balances.accounts.length > 0 && (
        <>
          <h2>Contas da sociedade</h2>
          <ul className="balances">
            {balances.accounts.map((a) => (
              <li key={a.id}>
                <p className="balances-name">{a.name}</p>
                <p>{signedReais(a.balanceCents)}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Plan section 3: who owns the building is not settled here. */}
      <div className="notice">
        <p>
          Os saldos mostram quanto cada um contribuiu. Eles não definem quem é
          dono do imóvel.
        </p>
      </div>
    </section>
  );
}
