import type { CurrentProject, RecordedExpense } from "@partneroj/contracts";
import { type FormEvent, useEffect, useState } from "react";

import { api, type Failure, type Result } from "./api";
import {
  ReceiptField,
  useReceiptChoice,
  useReceiptUpload,
} from "./ExpenseReceipt";
import { SavedScreen } from "./ExpenseSaved";
import {
  type DraftProblem,
  type ExpenseDraft,
  localDate,
  readDraft,
} from "./expenseDraft";
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
  // The key was already used for another expense: save makes a new one,
  // so tapping again works.
  conflict: "Algo deu errado e o gasto não foi salvo. Toque em Salvar de novo.",
  busy: "Muitas tentativas, e o gasto não foi salvo. Espere um minuto e toque em Salvar de novo.",
  error: "Algo deu errado e o gasto não foi salvo. Toque em Salvar de novo.",
};

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
  const photo = useReceiptChoice();
  const upload = useReceiptUpload();
  // One key per draft, kept while "Salvar" is tapped again after a lost
  // answer, so the server records it once. Any edit makes a new one: the
  // server must never answer a corrected draft with the expense before.
  const [saveKey, setSaveKey] = useState(() => crypto.randomUUID());

  const change = (fields: Partial<ExpenseDraft>) => {
    setDraft((before) => ({ ...before, ...fields }));
    setSaveKey(crypto.randomUUID());
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    // A second tap while the first is on its way would record it twice.
    if (saving || photo.preparing) return;
    const read = readDraft(current.project.id, draft);
    if (!read.ok) {
      setProblems(read.problems);
      return;
    }
    setProblems([]);
    setSendProblem(null);
    setSaving(true);
    const result = await api.recordExpense(read.body, saveKey);
    setSaving(false);
    if (!result.ok) {
      // 409: this key holds another expense, so it can't save this one.
      if (result.failure === "conflict") setSaveKey(crypto.randomUUID());
      setSendProblem(result.failure);
      return;
    }
    setSaved(result.value);
    if (photo.receipt !== null) {
      void upload.send(result.value.id, photo.receipt.blob);
    }
  }

  if (saved !== null) {
    const receipt = photo.receipt;
    return (
      <SavedScreen
        saved={saved}
        category={
          current.categories.find((c) => c.id === draft.categoryId)?.name
        }
        upload={upload.upload}
        preparing={photo.preparing}
        receiptProblem={photo.problem}
        onRetry={
          receipt === null
            ? undefined
            : () => void upload.send(saved.id, receipt.blob)
        }
        // The photo forgotten before saving, sent right away.
        onChoose={(event) =>
          void photo.choose(event).then((ready) => {
            if (ready !== null) void upload.send(saved.id, ready.blob);
          })
        }
        onAnother={() => {
          // The same day is the likeliest for the next receipt too.
          setDraft(emptyDraft(draft.occurredOn));
          setSaveKey(crypto.randomUUID());
          setSaved(null);
          photo.clear();
          upload.reset();
        }}
      />
    );
  }

  return (
    <section>
      <h1>Fiz um gasto</h1>
      <p className="muted">
        Do seu bolso, no projeto <strong>{current.project.name}</strong>.
      </p>

      <form onSubmit={(event) => void save(event)} noValidate>
        <DraftFields
          draft={draft}
          problems={problems}
          categories={current.categories}
          today={today}
          onChange={change}
        />

        <ReceiptField
          choice={{ ...photo, onChoose: (event) => void photo.choose(event) }}
        />

        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={saving || photo.preparing}
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

/** Valor, O que foi, Data and Descrição, each with its problem. */
function DraftFields({
  draft,
  problems,
  categories,
  today,
  onChange,
}: {
  draft: ExpenseDraft;
  problems: DraftProblem[];
  categories: CurrentProject["categories"];
  today: string;
  onChange: (fields: Partial<ExpenseDraft>) => void;
}) {
  const has = (problem: DraftProblem) => problems.includes(problem);
  return (
    <>
      <div className="field">
        <label htmlFor="amount">Valor (R$)</label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={draft.amount}
          onChange={(event) => onChange({ amount: event.target.value })}
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
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className="choice"
              aria-pressed={draft.categoryId === category.id}
              onClick={() => onChange({ categoryId: category.id })}
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
          onChange={(event) => onChange({ occurredOn: event.target.value })}
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
          onChange={(event) => onChange({ description: event.target.value })}
          aria-invalid={has("description")}
        />
        {has("description") && (
          <p className="problem">{problemText.description}</p>
        )}
      </div>
    </>
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
