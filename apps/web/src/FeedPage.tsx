import type { FeedItem } from "@partneroj/contracts";
import { useEffect, useState } from "react";

import { api, type Failure, type Me } from "./api";
import { describeItem, formatWhen, receiptLabel, unreadIds } from "./feed";

const loadProblemText: Record<Failure, string> = {
  offline: "Sem conexão. Confira a internet e toque em Tentar de novo.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  error: "Algo deu errado. Toque em Tentar de novo.",
  refused: "Algo deu errado. Toque em Tentar de novo.",
  unsupported: "Algo deu errado. Toque em Tentar de novo.",
  unusable: "Algo deu errado. Toque em Tentar de novo.",
};

/**
 * "Atividades" (plan section 5): everything that happened, newest first,
 * with who, when and the receipt. Even if a push is lost, it is here.
 */
export function FeedPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<Failure | null>(null);

  /** The first page, or the one after `before`, added to the end. */
  async function load(before?: string) {
    setLoading(true);
    setProblem(null);
    const [who, page] = await Promise.all([
      me === null
        ? api.me()
        : Promise.resolve({ ok: true, value: me } as const),
      api.feed(before),
    ]);
    setLoading(false);
    if (!who.ok) return setProblem(who.failure);
    if (!page.ok) return setProblem(page.failure);
    setMe(who.value);
    setItems((shown) =>
      before === undefined ? page.value.items : [...shown, ...page.value.items],
    );
    setNext(page.value.next);
    // Seen now, so read from the next visit on; the "Novo" badges stay
    // for this one. A lost call only means they show once more.
    const seen = unreadIds(page.value.items);
    if (seen.length > 0) void api.markRead({ ids: seen });
  }

  useEffect(() => {
    void load();
    // Only once, on opening the screen.
  }, []);

  const now = new Date();
  return (
    <section>
      <p>
        <a href="/">← Voltar ao início</a>
      </p>
      <h1>Atividades</h1>

      {me !== null && items.length === 0 && !loading && (
        <p className="muted">Nada aconteceu ainda.</p>
      )}

      {me !== null && items.length > 0 && (
        <ol className="feed">
          {items.map((item) => {
            const text = describeItem(item, me.memberId);
            return (
              <li key={item.id} className={item.unread ? "unread" : undefined}>
                <p className="feed-when muted">
                  {formatWhen(item.at, now)}
                  {text.badges.map((badge) => (
                    <span key={badge} className={`badge badge-${badge}`}>
                      {badge}
                    </span>
                  ))}
                </p>
                <p className="feed-headline">{text.headline}</p>
                {text.details.map((detail) => (
                  <p key={detail} className="feed-detail">
                    {detail}
                  </p>
                ))}
                {item.entry?.receipts.map((receipt) => (
                  <p key={receipt.id} className="feed-detail">
                    <a
                      href={`/api/receipts/${receipt.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {receiptLabel(receipt.contentType)}
                    </a>
                  </p>
                ))}
              </li>
            );
          })}
        </ol>
      )}

      {loading && <p className="muted">Carregando…</p>}

      {problem !== null && (
        <div className="actions">
          <p role="alert" className="problem">
            {loadProblemText[problem]}
          </p>
          {problem !== "signed-out" && (
            <button
              type="button"
              className="secondary"
              onClick={() => void load(items.at(-1)?.id)}
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}

      {!loading && problem === null && next !== null && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void load(next)}
          >
            Ver mais antigas
          </button>
        </div>
      )}
    </section>
  );
}
