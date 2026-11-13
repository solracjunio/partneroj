import type { CurrentProject, RecordedExpense } from "@partneroj/contracts";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";

import { api, type Failure, type Result } from "./api";
import {
  type DraftProblem,
  type ExpenseDraft,
  formatDate,
  localDate,
  readDraft,
} from "./expenseForm";
import { formatCents } from "./money";
import {
  prepareReceipt,
  type ReadyReceipt,
  type ReceiptProblem,
} from "./receiptPhoto";
import {
  ReceiptChooser,
  ReceiptPreview,
  receiptProblemText,
  retryable,
  uploadProblemText,
} from "./ReceiptParts";
import { navigate } from "./routes";

const problemText: Record<DraftProblem, string> = {
  amount: "Digite o valor, por exemplo 12,50.",
  category: "Escolha o que foi.",
  date: "Escolha a data do gasto.",
  description: "A descrição pode ter até 200 letras.",
};

const sendProblemText: Record<Failure, string> = {
  offline: "Sem conexão. Confira a internet e toque em Salvar de novo.",
  "signed-out": "Você saiu do Partneroj. Abra o app de novo para entrar.",
  refused: "Seu acesso não permite registrar gastos neste projeto.",
  unsupported: "O servidor não aceitou o gasto. Toque em Salvar de novo.",
  unusable: "Este projeto não aceita mais gastos. Volte ao início.",
  conflict: "Algo deu errado e o gasto não foi salvo. Toque em Salvar de novo.",
  error: "Algo deu errado e o gasto não foi salvo. Toque em Salvar de novo.",
};

type Upload = "none" | "sending" | "sent" | Failure;

function emptyDraft(occurredOn: string): ExpenseDraft {
  return { amount: "", categoryId: null, occurredOn, description: "" };
}

/**
 * "Fiz um gasto" (plan section 5): an expense paid from the partner's own
 * pocket, with the photo of the receipt if there is one. The expense is
 * saved first and the photo after it: a photo that fails to go up never
 * loses the expense, and can be sent again.
 */
export function ExpenseForm() {
  const [current, setCurrent] = useState<Result<CurrentProject> | null>(null);

  useEffect(() => {
    let active = true;
    void api.currentProject().then((result) => {
      if (active) setCurrent(result);
    });
    return () => {
      active = false;
    };
  }, []);

  if (current === null) return <p className="muted">Carregando…</p>;
  if (!current.ok) return <ProjectProblem failure={current.failure} />;
  return <Form current={current.value} />;
}

function Form({ current }: { current: CurrentProject }) {
  const today = localDate(new Date());
  const [draft, setDraft] = useState<ExpenseDraft>(() => emptyDraft(today));
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [sendProblem, setSendProblem] = useState<Failure | null>(null);
  const [saved, setSaved] = useState<RecordedExpense | null>(null);
  const [receipt, setReceipt] = useState<ReadyReceipt | null>(null);
  const [receiptProblem, setReceiptProblem] = useState<ReceiptProblem | null>(
    null,
  );
  const [preparing, setPreparing] = useState(false);
  const [upload, setUpload] = useState<Upload>("none");

  const change = (fields: Partial<ExpenseDraft>) =>
    setDraft((before) => ({ ...before, ...fields }));
  const has = (problem: DraftProblem) => problems.includes(problem);

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
      setReceiptProblem(null);
      return prepared.receipt;
    }
    setReceipt(null);
    setReceiptProblem(prepared.problem);
    return null;
  }

  /** On "Gasto salvo.": the photo forgotten before saving, sent right away. */
  async function chooseAfterSaving(
    entryId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const ready = await choose(event);
    if (ready !== null) await sendReceipt(entryId, ready.blob);
  }

  async function sendReceipt(entryId: string, file: Blob) {
    setUpload("sending");
    const result = await api.addReceipt(entryId, file);
    setUpload(result.ok ? "sent" : result.failure);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    // A second tap while the first is on its way would record it twice.
    if (saving || preparing) return;
    const read = readDraft(current.project.id, draft);
    if (!read.ok) {
      setProblems(read.problems);
      return;
    }
    setProblems([]);
    setSendProblem(null);
    setSaving(true);
    const result = await api.recordExpense(read.body);
    setSaving(false);
    if (!result.ok) {
      setSendProblem(result.failure);
      return;
    }
    setSaved(result.value);
    if (receipt !== null) void sendReceipt(result.value.id, receipt.blob);
  }

  if (saved !== null) {
    const category = current.categories.find((c) => c.id === draft.categoryId);
    return (
      <section>
        <h1>Gasto salvo.</h1>
        <p>
          <strong>R$ {formatCents(saved.amountCents)}</strong>
          {category && <> em {category.name}</>}, no dia{" "}
          {formatDate(saved.occurredOn)}.
        </p>
        <UploadStatus
          upload={upload}
          onRetry={
            receipt === null
              ? undefined
              : () => void sendReceipt(saved.id, receipt.blob)
          }
        />
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
              <ReceiptChooser
                onChoose={(event) => void chooseAfterSaving(saved.id, event)}
              />
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
            onClick={() => {
              // The same day is the likeliest for the next receipt too.
              setDraft(emptyDraft(draft.occurredOn));
              setSaved(null);
              setReceipt(null);
              setReceiptProblem(null);
              setUpload("none");
            }}
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

  return (
    <section>
      <h1>Fiz um gasto</h1>
      <p className="muted">
        Do seu bolso, no projeto <strong>{current.project.name}</strong>.
      </p>

      <form onSubmit={(event) => void save(event)} noValidate>
        <div className="field">
          <label htmlFor="amount">Valor (R$)</label>
          <input
            id="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={draft.amount}
            onChange={(event) => change({ amount: event.target.value })}
            aria-invalid={has("amount")}
            aria-describedby={has("amount") ? "amount-problem" : undefined}
          />
          {has("amount") && (
            <p id="amount-problem" className="problem">
              {problemText.amount}
            </p>
          )}
        </div>

        <fieldset className="field">
          <legend>O que foi</legend>
          <div className="choices">
            {current.categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className="choice"
                aria-pressed={draft.categoryId === category.id}
                onClick={() => change({ categoryId: category.id })}
              >
                {category.name}
              </button>
            ))}
          </div>
          {has("category") && <p className="problem">{problemText.category}</p>}
        </fieldset>

        <div className="field">
          <label htmlFor="occurred-on">Data</label>
          <input
            id="occurred-on"
            type="date"
            max={today}
            value={draft.occurredOn}
            onChange={(event) => change({ occurredOn: event.target.value })}
            aria-invalid={has("date")}
          />
          {has("date") && <p className="problem">{problemText.date}</p>}
        </div>

        <div className="field">
          <label htmlFor="description">
            Descrição <span className="muted">(se quiser)</span>
          </label>
          <input
            id="description"
            type="text"
            maxLength={200}
            placeholder="Por exemplo: 10 sacos de cimento"
            value={draft.description}
            onChange={(event) => change({ description: event.target.value })}
            aria-invalid={has("description")}
          />
          {has("description") && (
            <p className="problem">{problemText.description}</p>
          )}
        </div>

        <ReceiptField
          receipt={receipt}
          problem={receiptProblem}
          preparing={preparing}
          onChoose={(event) => void choose(event)}
          onRemove={() => {
            setReceipt(null);
            setReceiptProblem(null);
          }}
        />

        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={saving || preparing}
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
          {sendProblem !== null && (
            <p role="alert" className="problem">
              {sendProblemText[sendProblem]}
            </p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => navigate("/")}
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}

function ReceiptField({
  receipt,
  problem,
  preparing,
  onChoose,
  onRemove,
}: {
  receipt: ReadyReceipt | null;
  problem: ReceiptProblem | null;
  preparing: boolean;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="field">
      <legend>
        Comprovante <span className="muted">(se quiser)</span>
      </legend>
      {preparing && <p className="muted">Preparando a foto…</p>}
      {receipt !== null && !preparing && (
        <div className="receipt">
          <ReceiptPreview receipt={receipt} />
          <button type="button" className="secondary" onClick={onRemove}>
            Tirar o comprovante
          </button>
        </div>
      )}
      {receipt === null && !preparing && <ReceiptChooser onChoose={onChoose} />}
      {problem !== null && (
        <p role="alert" className="problem">
          {receiptProblemText[problem]}
        </p>
      )}
    </fieldset>
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

function ProjectProblem({ failure }: { failure: Failure }) {
  const text =
    failure === "unusable"
      ? "Ainda não há um projeto aberto. Peça a um administrador para criar um."
      : failure === "signed-out"
        ? "Você saiu do Partneroj. Abra o app de novo para entrar."
        : failure === "offline"
          ? "Sem conexão. Confira a internet e abra de novo."
          : "Algo deu errado. Tente de novo daqui a pouco.";
  return (
    <section>
      <h1>Fiz um gasto</h1>
      <p role="alert">{text}</p>
      <button type="button" className="secondary" onClick={() => navigate("/")}>
        Voltar ao início
      </button>
    </section>
  );
}
