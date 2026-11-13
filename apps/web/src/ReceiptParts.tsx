// The pieces of a receipt that "Fiz um gasto" and the entry screen share:
// choosing it, seeing it before it goes, and the words when it fails.
import { type ChangeEvent, useEffect, useId, useState } from "react";

import type { Failure } from "./api";
import type { ReadyReceipt, ReceiptProblem } from "./receiptPhoto";

/** Why a chosen file can't be sent, in plain words. */
export const receiptProblemText: Record<ReceiptProblem, string> = {
  kind: "Escolha uma foto ou um PDF.",
  unreadable: "Não deu para abrir esta foto. Tire outra pela câmera.",
  "too-big": "O PDF passa de 10 MB. Escolha um arquivo menor.",
};

/** The upload failed; the entry it goes to is saved either way. */
export const uploadProblemText: Record<Failure, string> = {
  offline: "Sem conexão, e a foto não foi enviada.",
  error: "Algo deu errado, e a foto não foi enviada.",
  unsupported: "O servidor não aceitou este arquivo.",
  "signed-out": "Você saiu do Partneroj, e a foto não foi enviada.",
  refused: "Seu acesso não permite enviar a foto.",
  unusable: "Este gasto não aceita mais fotos.",
  conflict: "Algo deu errado, e a foto não foi enviada.",
};

/** Worth another tap: the connection or the server, not the file. */
export const retryable = new Set<Failure>(["offline", "error"]);

/** The chosen photo, as it will go up, or the PDF's name. */
export function ReceiptPreview({ receipt }: { receipt: ReadyReceipt }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (receipt.kind !== "photo") {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(receipt.blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [receipt]);

  return preview !== null ? (
    <img src={preview} alt="A foto do comprovante" />
  ) : (
    <p>
      PDF: <strong>{receipt.name}</strong>
    </p>
  );
}

/**
 * Two buttons: the camera, or a photo or PDF already on the phone. Used
 * by "Fiz um gasto" and by "Adicionar comprovante" on the entry screen.
 */
export function ReceiptChooser({
  onChoose,
}: {
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  // Each chooser its own ids, so a label never opens another one's input.
  const id = useId();
  return (
    <div className="choices">
      {/* The label is the button; the input itself stays hidden. */}
      <label className="choice" htmlFor={`${id}-camera`}>
        Tirar foto
      </label>
      <input
        id={`${id}-camera`}
        className="hidden-file"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onChoose}
      />
      <label className="choice" htmlFor={`${id}-file`}>
        Escolher arquivo
      </label>
      <input
        id={`${id}-file`}
        className="hidden-file"
        type="file"
        accept="image/*,application/pdf"
        onChange={onChoose}
      />
    </div>
  );
}
