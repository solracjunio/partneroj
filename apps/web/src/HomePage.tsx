import type { ProjectBalances } from "@partneroj/contracts";
import { useEffect, useState } from "react";

import { api, type Me, type Result } from "./api";
import {
  balanceHint,
  comparisonFor,
  nothingPutIn,
  partnerOf,
  signedReais,
} from "./balances";
import { feedButtonLabel } from "./feed";
import { InstallCard } from "./InstallCard";
import { NotificationsCard } from "./NotificationsCard";
import { formatCents } from "./money";
import { navigate } from "./routes";

/**
 * The first screen: who is signed in, the "Fiz um gasto" button, the way
 * to the feed, and how much one already put in (plan section 5).
 */
export function HomePage() {
  const [me, setMe] = useState<Result<Me> | null>(null);
  const [unread, setUnread] = useState(0);
  const [balances, setBalances] = useState<ProjectBalances | null>(null);

  useEffect(() => {
    let current = true;
    void api.me().then((result) => {
      if (current) setMe(result);
    });
    // Only a hint on the button: without it, the button just says
    // "Atividades".
    void api.unreadCount().then((result) => {
      if (current && result.ok) setUnread(result.value.count);
    });
    // Also only a hint: without it (no project yet, no connection) the
    // screen has no summary, and the rest works.
    void api.balances().then((result) => {
      if (current && result.ok) setBalances(result.value);
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
            {feedButtonLabel(unread)}
          </button>
        </div>
        {balances !== null && (
          <BalanceSummary balances={balances} memberId={me.value.memberId} />
        )}
        <InstallCard />
        <NotificationsCard />
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

/**
 * "Você já colocou" (plan section 5), compared with the average or one's
 * part by weight, and the balance in plain words. A reader has no weight:
 * only the way to everyone's balances.
 */
function BalanceSummary({
  balances,
  memberId,
}: {
  balances: ProjectBalances;
  memberId: string;
}) {
  const mine = partnerOf(balances, memberId);
  const link = (
    <p>
      <a className="entry-link" href="/saldos">
        {mine === undefined ? "Ver os saldos ▸" : "Ver os saldos de todos ▸"}
      </a>
    </p>
  );
  if (mine === undefined) return <div className="summary">{link}</div>;
  if (nothingPutIn(balances)) {
    return (
      <div className="summary">
        <p>Ninguém colocou nada ainda.</p>
        {link}
      </div>
    );
  }
  const comparison = comparisonFor(balances, mine);
  return (
    <div className="summary">
      <p>Você já colocou</p>
      <p className="summary-amount">R$ {formatCents(mine.contributedCents)}</p>
      <p className="muted">
        {comparison.label}: R$ {formatCents(comparison.cents)}
      </p>
      <p>Seu saldo: {signedReais(mine.balanceCents)}</p>
      <p>{balanceHint(mine.balanceCents)}</p>
      {link}
    </div>
  );
}
