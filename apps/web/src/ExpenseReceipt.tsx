// The receipt photo of "Fiz um gasto": choosing it, preparing it on the
// phone and sending it once the expense is saved. Kept apart from the
// form, which changes for other reasons (its fields and the save).
import { type ChangeEvent, useState } from "react";

import { api, type Failure } from "./api";
import {
  prepareReceipt,
  type ReadyReceipt,
  type ReceiptProblem,
} from "./receiptPhoto";
import {
  ReceiptChooser,
  ReceiptPreview,
  receiptProblemText,
} from "./ReceiptParts";

export interface ReceiptChoice {
  receipt: ReadyReceipt | null;
  problem: ReceiptProblem | null;
  preparing: boolean;
  /** Prepares the chosen file; the receipt, or null when there is none. */
  choose: (
    event: ChangeEvent<HTMLInputElement>,
  ) => Promise<ReadyReceipt | null>;
  clear: () => void;
}

/** The photo chosen for the expense, reduced on the phone before it goes. */
export function useReceiptChoice(): ReceiptChoice {
  const [receipt, setReceipt] = useState<ReadyReceipt | null>(null);
  const [problem, setProblem] = useState<ReceiptProblem | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function choose(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<ReadyReceipt | null> {
    const file = event.target.files?.[0];
    // Cleared, so choosing the same file again still counts as a change.
    event.target.value = "";
    if (file === undefined) return null;
    setPreparing(true);
    const prepared = await prepareReceipt(file);
    setPreparing(false);
    if (prepared.ok) {
      setReceipt(prepared.receipt);
      setProblem(null);
      return prepared.receipt;
    }
    setReceipt(null);
    setProblem(prepared.problem);
    return null;
  }

  function clear() {
    setReceipt(null);
    setProblem(null);
  }

  return { receipt, problem, preparing, choose, clear };
}

export type Upload = "none" | "sending" | "sent" | Failure;

/** Sending the photo of a saved expense, and how it is going. */
export function useReceiptUpload() {
  const [upload, setUpload] = useState<Upload>("none");

  async function send(entryId: string, file: Blob) {
    setUpload("sending");
    const result = await api.addReceipt(entryId, file);
    setUpload(result.ok ? "sent" : result.failure);
  }

  return { upload, send, reset: () => setUpload("none") };
}

/** The form's "Comprovante" field: choose a photo, see it, or take it out. */
export function ReceiptField({
  choice,
}: {
  choice: Pick<ReceiptChoice, "receipt" | "problem" | "preparing" | "clear"> & {
    onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  };
}) {
  const { receipt, problem, preparing } = choice;
  return (
    <fieldset className="field">
      <legend>
        Comprovante <span className="muted">(se quiser)</span>
      </legend>
      {preparing && <p className="muted">Preparando a foto…</p>}
      {receipt !== null && !preparing && (
        <div className="receipt">
          <ReceiptPreview receipt={receipt} />
          <button type="button" className="secondary" onClick={choice.clear}>
            Tirar o comprovante
          </button>
        </div>
      )}
      {receipt === null && !preparing && (
        <ReceiptChooser onChoose={choice.onChoose} />
      )}
      {problem !== null && (
        <p role="alert" className="problem">
          {receiptProblemText[problem]}
        </p>
      )}
    </fieldset>
  );
}
