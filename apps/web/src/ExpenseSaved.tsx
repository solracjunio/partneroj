// "Gasto salvo.": the screen after "Fiz um gasto" records the expense.
import type { RecordedExpense } from "@partneroj/contracts";
import type { ChangeEvent } from "react";

import type { Upload } from "./ExpenseReceipt";
import { formatDate } from "./expenseDraft";
import { formatCents } from "./money";
import type { ReceiptProblem } from "./receiptPhoto";
import {
  ReceiptChooser,
  receiptProblemText,
  retryable,
  uploadProblemText,
} from "./ReceiptParts";
import { navigate } from "./routes";

/**
 * What was recorded, how the photo is going, and the way to the next
 * expense. A photo forgotten, or one the server refused, can still be sent
 * from here.
 */
export function SavedScreen({
  saved,
  category,
  upload,
  preparing,
  receiptProblem,
  onRetry,
  onChoose,
  onAnother,
}: {
  saved: RecordedExpense;
  category: string | undefined;
  upload: Upload;
  preparing: boolean;
  receiptProblem: ReceiptProblem | null;
  /** Sends the photo again; undefined when there is none to send. */
  onRetry: (() => void) | undefined;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onAnother: () => void;
}) {
  return (
    <section>
      <h1>Gasto salvo.</h1>
      <p>
        <strong>R$ {formatCents(saved.amountCents)}</strong>
        {category && <> em {category}</>}, no dia {formatDate(saved.occurredOn)}
        .
      </p>
      <UploadStatus upload={upload} onRetry={onRetry} />
      {/* No photo yet, or one the server refused: another can still go. */}
      {(upload === "none" || upload === "unsupported") && (
        <fieldset className="field">
          <legend>
            {upload === "none"
              ? "Esqueceu o comprovante?"
              : "Quer mandar outro arquivo?"}
          </legend>
          {preparing ? (
            <p className="muted">Preparando a foto…</p>
          ) : (
            <ReceiptChooser onChoose={onChoose} />
          )}
          {receiptProblem !== null && (
            <p role="alert" className="problem">
              {receiptProblemText[receiptProblem]}
            </p>
          )}
        </fieldset>
      )}
      <div className="actions">
        <button
          type="button"
          className="primary"
          // The answer of a photo still going up would land on the next
          // expense.
          disabled={upload === "sending" || preparing}
          onClick={onAnother}
        >
          Fiz outro gasto
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => navigate("/")}
        >
          Voltar ao início
        </button>
      </div>
    </section>
  );
}

function UploadStatus({
  upload,
  onRetry,
}: {
  upload: Upload;
  onRetry: (() => void) | undefined;
}) {
  if (upload === "none") return null;
  if (upload === "sending") {
    return (
      <p role="status" className="muted">
        Enviando a foto…
      </p>
    );
  }
  if (upload === "sent") {
    return <p role="status">Foto do comprovante enviada.</p>;
  }
  return (
    <div className="actions">
      <p role="alert" className="problem">
        {uploadProblemText[upload]} O gasto já está salvo.
      </p>
      {retryable.has(upload) && onRetry !== undefined && (
        <button type="button" className="primary" onClick={onRetry}>
          Enviar a foto de novo
        </button>
      )}
    </div>
  );
}
