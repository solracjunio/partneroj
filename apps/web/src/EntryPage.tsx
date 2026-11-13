import type { EntryDetails } from "@partneroj/contracts";
import { useEffect, useState } from "react";

import { api, type Failure, type Me } from "./api";
import {
  checkReason,
  describeEntry,
  loadProblemText,
  REASON_MAX,
  reverseProblemText,
} from "./entry";
import { receiptLabel } from "./feed";
import { entryLink } from "./routes";

/**
 * "Desfazer" goes in steps, so a single tap undoes nothing: the button
 * opens the reason field, and only "Confirmar" sends it.
 */
type Undo =
  | { step: "closed" }
  | { step: "asking"; problem?: string }
  | { step: "sending" }
  | { step: "done" }
  | { step: "failed"; failure: Failure };

/**
 * "Lançamento" (plan section 5): one entry with who paid, who recorded
 * it, the receipts and its status. Its author can undo it from here.
 */
export function EntryPage({ id }: { id: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [entry, setEntry] = useState<EntryDetails | null>(null);
  const [problem, setProblem] = useState<Failure | null>(null);
  const [reason, setReason] = useState("");
  const [undo, setUndo] = useState<Undo>({ step: "closed" });

  async function load() {
    setProblem(null);
    const [who, details] = await Promise.all([api.me(), api.entry(id)]);
    if (!who.ok) return setProblem(who.failure);
    if (!details.ok) return setProblem(details.failure);
    setMe(who.value);
    setEntry(details.value);
  }

  useEffect(() => {
    void load();
    // Only once: App gives each entry its own page (key).
  }, []);

  async function confirmUndo() {
    const checked = checkReason(reason);
    if (!checked.ok)
      return setUndo({ step: "asking", problem: checked.problem });
    setUndo({ step: "sending" });
    const result = await api.reverseEntry(id, { reason: checked.reason });
    if (result.ok) {
      setUndo({ step: "done" });
    } else {
      setUndo({ step: "failed", failure: result.failure });
    }
    // Undone now, or by someone else first (409): the screen shows the
    // server's state either way, never a guess of it.
    if (result.ok || result.failure === "conflict") await load();
  }

  const back = (
    <p>
      <a href="/atividades">← Voltar às atividades</a>
    </p>
  );

  if (problem !== null) {
    return (
      <section>
        {back}
        <h1>Lançamento</h1>
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

  if (me === null || entry === null) {
    return (
      <section>
        {back}
        <h1>Lançamento</h1>
        <p className="muted">Carregando…</p>
      </section>
    );
  }

  const text = describeEntry(entry, me.memberId, new Date());
  return (
    <section>
      {back}
      <h1>{text.title}</h1>

      <p className="entry-status">
        <span className={`badge badge-${text.status.label}`}>
          {text.status.label}
        </span>
      </p>
      {text.status.details.map((detail) => (
        <p key={detail}>{detail}</p>
      ))}

      <dl className="entry-facts">
        {text.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>

      {entry.receipts.length === 0 ? (
        <p className="muted">Sem comprovante.</p>
      ) : (
        entry.receipts.map((receipt) => (
          <p key={receipt.id}>
            <a
              className="entry-link"
              href={`/api/receipts/${receipt.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {receiptLabel(receipt.contentType)}
            </a>
          </p>
        ))
      )}

      {entry.reversalOf !== null && (
        <p>
          <a className="entry-link" href={entryLink(entry.reversalOf)}>
            Ver o gasto que foi desfeito ▸
          </a>
        </p>
      )}
      {entry.reversal !== null && (
        <p>
          <a className="entry-link" href={entryLink(entry.reversal.id)}>
            Ver o lançamento que desfez ▸
          </a>
        </p>
      )}

      {undo.step === "done" && (
        <p role="status" className="notice">
          Gasto desfeito. Os outros sócios vão ver o motivo nas atividades.
        </p>
      )}

      {undo.step === "failed" && (
        <p role="alert" className="problem">
          {reverseProblemText[undo.failure]}
        </p>
      )}

      {entry.canReverse &&
        undo.step !== "asking" &&
        undo.step !== "sending" && (
          <div className="actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setUndo({ step: "asking" })}
            >
              Desfazer este gasto
            </button>
          </div>
        )}

      {entry.canReverse &&
        (undo.step === "asking" || undo.step === "sending") && (
          <div className="undo">
            <div className="field">
              <label htmlFor="reason">Por que desfazer?</label>
              <p className="muted">
                O gasto continua no histórico, marcado como desfeito. Os outros
                sócios veem o motivo.
              </p>
              <textarea
                id="reason"
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={
                  undo.step === "asking" && undo.problem !== undefined
                }
                disabled={undo.step === "sending"}
              />
              {undo.step === "asking" && undo.problem !== undefined && (
                <p className="problem">{undo.problem}</p>
              )}
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={undo.step === "sending"}
                onClick={() => void confirmUndo()}
              >
                {undo.step === "sending"
                  ? "Desfazendo…"
                  : "Confirmar: desfazer"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={undo.step === "sending"}
                onClick={() => setUndo({ step: "closed" })}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
    </section>
  );
}
