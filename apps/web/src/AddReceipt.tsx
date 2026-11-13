import { type ChangeEvent, useState } from "react";

import { api, type Failure } from "./api";
import {
  ReceiptChooser,
  ReceiptPreview,
  receiptProblemText,
  retryable,
  uploadProblemText,
} from "./ReceiptParts";
import {
  prepareReceipt,
  type ReadyReceipt,
  type ReceiptProblem,
} from "./receiptPhoto";

/**
 * Receipts can't be taken back (ADR 0006: nothing is deleted), so the
 * file is shown first and only "Enviar" sends it.
 */
type Step =
  | { step: "choosing"; problem?: ReceiptProblem }
  | { step: "preparing" }
  | { step: "ready"; receipt: ReadyReceipt; failure?: Failure }
  | { step: "sending"; receipt: ReadyReceipt }
  | { step: "sent" };

/**
 * "Adicionar comprovante" on the entry screen: a photo or PDF for an
 * entry already saved, such as the receipt that arrived days later.
 * `onAdded` reloads the entry, so its list shows the new receipt.
 */
export function AddReceipt({
  entryId,
  hasReceipts,
  onAdded,
}: {
  entryId: string;
  hasReceipts: boolean;
  onAdded: () => Promise<void>;
}) {
  const [state, setState] = useState<Step>({ step: "choosing" });

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared, so choosing the same file again still counts as a change.
    event.target.value = "";
    if (file === undefined) return;
    setState({ step: "preparing" });
    const prepared = await prepareReceipt(file);
    setState(
      prepared.ok
        ? { step: "ready", receipt: prepared.receipt }
        : { step: "choosing", problem: prepared.problem },
    );
  }

  async function send(receipt: ReadyReceipt) {
    setState({ step: "sending", receipt });
    const result = await api.addReceipt(entryId, receipt.blob);
    if (!result.ok) {
      return setState({ step: "ready", receipt, failure: result.failure });
    }
    setState({ step: "sent" });
    await onAdded();
  }

  return (
    <fieldset className="field">
      <legend>
        {hasReceipts ? "Adicionar outro comprovante" : "Adicionar comprovante"}
      </legend>

      {state.step === "sent" && (
        <div className="actions">
          <p role="status">Comprovante adicionado.</p>
          <button
            type="button"
            className="secondary"
            onClick={() => setState({ step: "choosing" })}
          >
            Adicionar mais um
          </button>
        </div>
      )}

      {state.step === "choosing" && (
        <>
          <ReceiptChooser onChoose={(event) => void choose(event)} />
          {state.problem !== undefined && (
            <p role="alert" className="problem">
              {receiptProblemText[state.problem]}
            </p>
          )}
        </>
      )}

      {state.step === "preparing" && (
        <p className="muted">Preparando a foto…</p>
      )}

      {(state.step === "ready" || state.step === "sending") && (
        <div className="receipt">
          <ReceiptPreview receipt={state.receipt} />
          <div className="actions">
            {state.step === "ready" && state.failure !== undefined && (
              <p role="alert" className="problem">
                {uploadProblemText[state.failure]}
              </p>
            )}
            {(state.step === "sending" ||
              state.failure === undefined ||
              retryable.has(state.failure)) && (
              <button
                type="button"
                className="primary"
                disabled={state.step === "sending"}
                onClick={() => void send(state.receipt)}
              >
                {state.step === "sending"
                  ? "Enviando…"
                  : state.failure === undefined
                    ? "Enviar este comprovante"
                    : "Enviar de novo"}
              </button>
            )}
            <button
              type="button"
              className="secondary"
              disabled={state.step === "sending"}
              onClick={() => setState({ step: "choosing" })}
            >
              Escolher outro
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
