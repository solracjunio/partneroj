/* global document, window, sessionStorage, URL, URLSearchParams, setTimeout */
// Clickable prototype for the block 0 test. Everything lives in memory:
// nothing is saved on a server and the photo never leaves the phone.
//
// Real names never go in git. They come in the link fragment, which the
// browser does not send to the server:
//   /prototipo/#eu=Name&outros=Name2,Name3&nota=Name2&meta=50000&t=1
// meta is each partner's goal in reals (a family amount, so also not in git).
// t=1 shows how many seconds the expense took (for the timed test).

// The fragment is wiped from the address bar after the first load, so keep
// it in this tab's session (on the phone only). Android may reload the page
// when coming back from the camera, and the names must survive that.
const fragment = window.location.hash.slice(1);
if (fragment) sessionStorage.setItem("prototype-names", fragment);
const params = new URLSearchParams(
  fragment || sessionStorage.getItem("prototype-names") || "",
);
const me = params.get("eu") || "Ana";
const others = (params.get("outros") || "Bruno,Carla").split(",").slice(0, 2);
const invoiceDefault = params.get("nota") || others[0];
const showTimer = params.get("t") === "1";
const GOAL = Number(params.get("meta")) || 50000;
const VOTERS = 3;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const $ = (selector) => document.querySelector(selector);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

let nextId = 1;
const entry = (who, amount, category, when) => ({
  id: nextId++,
  who,
  amount,
  category,
  when,
  photo: true,
  undone: null,
});

const seed = [
  entry(others[0], 1200, "Material", "ontem"),
  entry(others[1], 350, "Material", "há 2 dias"),
  entry(me, 480, "Taxas", "há 3 dias"),
];

const state = {
  totals: { [me]: 12400, [others[0]]: 11200, [others[1]]: 12100 },
  feed: seed,
  // Votes on an entry. `yes`/`no` hold who voted; the opener votes like anyone.
  votes: [
    {
      entryId: seed[1].id,
      opener: others[0],
      kind: "corrigir",
      to: 305,
      reason: "a nota da loja é de R$ 305,00.",
      daysLeft: 5,
      yes: [others[0]],
      no: [],
    },
  ],
  form: { category: null, invoice: invoiceDefault, photoUrl: null },
  startedAt: null,
  lastEntry: null,
  current: null, // entry shown on the detail screen
  contestKind: null,
};

const findEntry = (id) => state.feed.find((e) => e.id === id);
const openVoteFor = (id) => state.votes.find((v) => v.entryId === id);
const nameOf = (who) => (who === me ? "Você" : who);

// ---- navigation -------------------------------------------------------

function go(id) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.id !== id;
  }
  window.scrollTo(0, 0);
  const render = {
    home: renderHome,
    feed: renderFeed,
    vote: renderVotes,
    entry: renderEntry,
  }[id];
  if (render) render();
}

// ---- 1. home ----------------------------------------------------------

function renderHome() {
  const mine = state.totals[me];
  $("#my-total").textContent = brl.format(mine);
  $("#my-bar").style.width = `${Math.min(100, (mine / GOAL) * 100)}%`;
  $("#my-goal").textContent = `da meta de ${brl.format(GOAL)}`;

  const list = $("#people");
  list.replaceChildren();
  for (const name of [me, ...others]) {
    const item = el("li");
    item.append(
      el("span", "", name === me ? `${name} (você)` : name),
      el("strong", "", brl.format(state.totals[name])),
    );
    list.append(item);
  }
  $('[data-go="vote"]').firstChild.textContent =
    `Votações abertas (${state.votes.length}) `;
}

// ---- 2. expense form --------------------------------------------------

function startExpense() {
  state.form = { category: null, invoice: invoiceDefault, photoUrl: null };
  state.startedAt = Date.now();
  $("#amount").value = "";
  $("#expense-error").textContent = "";
  $("#photo-thumb").hidden = true;
  for (const button of document.querySelectorAll("#category .choice")) {
    button.classList.remove("selected");
  }
  renderInvoiceChoices();
  go("expense");
}

function renderInvoiceChoices() {
  const box = $("#invoice");
  box.replaceChildren();
  for (const name of [me, ...others]) {
    const button = el("button", "choice", name === me ? "No meu nome" : name);
    button.dataset.value = name;
    button.classList.toggle("selected", name === state.form.invoice);
    box.append(button);
  }
}

function pick(group, button) {
  for (const other of group.querySelectorAll(".choice")) {
    other.classList.toggle("selected", other === button);
  }
}

function parseAmount(text) {
  const clean = text
    .replace(/[^\d,.]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const value = Number.parseFloat(clean);
  return Number.isFinite(value) && value > 0
    ? Math.round(value * 100) / 100
    : null;
}

function save() {
  const amount = parseAmount($("#amount").value);
  const error = $("#expense-error");
  if (amount === null)
    return (error.textContent = "Escreva quanto foi o gasto.");
  if (!state.form.category) return (error.textContent = "Escolha o que foi.");
  if (!state.form.photoUrl)
    return (error.textContent = "Falta a foto da nota.");

  const seconds = Math.round((Date.now() - state.startedAt) / 1000);
  const added = entry(me, amount, state.form.category, "agora");
  added.invoice = state.form.invoice;
  state.feed.unshift(added);
  state.totals[me] += amount;
  state.lastEntry = added;

  $("#done-amount").textContent = brl.format(amount);
  const invoiceName =
    added.invoice === me ? "no seu nome" : `no nome de ${added.invoice}`;
  $("#done-detail").textContent = `${added.category} · nota ${invoiceName}`;
  $("#done-notified").textContent = `${others.join(" e ")} receberam um aviso.`;
  $("#done-timer").textContent = `Tempo do teste: ${seconds} s`;
  $("#done-timer").hidden = !showTimer;
  $("#undo-box").hidden = true;
  go("done");
}

// ---- 3. photo ---------------------------------------------------------

function onPhoto(file) {
  if (!file) return;
  if (state.form.photoUrl) URL.revokeObjectURL(state.form.photoUrl);
  state.form.photoUrl = URL.createObjectURL(file);
  $("#photo-preview").src = state.form.photoUrl;
  go("photo-check");
}

function acceptPhoto() {
  $("#photo-thumb").src = state.form.photoUrl;
  $("#photo-thumb").hidden = false;
  $("#expense-error").textContent = "";
  go("expense");
}

// ---- undo (4. confirmation and 7. detail) -----------------------------

function undoEntry(target, reason) {
  target.undone = reason;
  state.totals[target.who] -= target.amount;
}

function undoFromConfirmation() {
  const reason = $("#undo-reason").value.trim();
  if (!reason) return ($("#undo-error").textContent = "Escreva o motivo.");
  undoEntry(state.lastEntry, reason);
  $("#undo-box").hidden = true;
  $("#done-notified").textContent =
    `Desfeito. ${others.join(" e ")} receberam um aviso.`;
  setTimeout(() => go("feed"), 1500);
}

function undoFromDetail() {
  const reason = $("#entry-undo-reason").value.trim();
  if (!reason)
    return ($("#entry-undo-error").textContent = "Escreva o motivo.");
  undoEntry(state.current, reason);
  go("entry");
}

// ---- 5. feed ----------------------------------------------------------

function renderFeed() {
  const list = $("#feed-list");
  list.replaceChildren();
  for (const item of state.feed) {
    const row = el("li");
    const button = el("button", "feed-item");
    button.dataset.entry = item.id;
    button.append(
      el(
        "p",
        item.undone ? "what undone" : "what",
        `${nameOf(item.who)} lançou ${brl.format(item.amount)}`,
      ),
      el(
        "p",
        "muted",
        `${item.category} · ${item.when}${item.photo ? " · 📷 nota" : ""}`,
      ),
    );
    if (item.undone)
      button.append(el("p", "muted", `Desfeito: ${item.undone}`));
    if (openVoteFor(item.id)) button.append(el("p", "status", "🗳️ Em votação"));
    row.append(button);
    list.append(row);
  }
}

// ---- 7. entry detail --------------------------------------------------

function showEntry(id) {
  state.current = findEntry(id);
  go("entry");
}

function renderEntry() {
  const item = state.current;
  const vote = openVoteFor(item.id);
  $("#entry-title").textContent =
    `${nameOf(item.who)} lançou ${brl.format(item.amount)}`;
  $("#entry-detail").textContent =
    `${item.category} · ${item.when} · 📷 foto da nota`;

  const status = $("#entry-status");
  status.hidden = !(item.undone || vote);
  if (item.undone) status.textContent = `Desfeito: ${item.undone}`;
  else if (vote)
    status.textContent =
      "🗳️ Em votação. Ele continua contando nos saldos até o fim.";

  const mine = item.who === me;
  // Plan rules: the author undoes their own entry; others contest it.
  // No vote on an undone entry, and only one open vote per entry.
  $("#entry-undo").hidden = !mine || Boolean(item.undone) || Boolean(vote);
  $("#entry-contest").hidden = mine || Boolean(item.undone) || Boolean(vote);
  $("#entry-undo-box").hidden = true;
  $("#entry-undo-reason").value = "";
  $("#entry-undo-error").textContent = "";
}

// ---- 8. contest -------------------------------------------------------

function startContest() {
  const item = state.current;
  state.contestKind = null;
  $("#contest-about").textContent =
    `${item.who} lançou ${brl.format(item.amount)} · ${item.category} · ${item.when}`;
  for (const button of document.querySelectorAll("#contest-kind .choice")) {
    button.classList.remove("selected");
  }
  $("#contest-amount-box").hidden = true;
  $("#contest-amount").value = "";
  $("#contest-reason").value = "";
  $("#contest-error").textContent = "";
  go("contest");
}

function openVote() {
  const error = $("#contest-error");
  const item = state.current;
  if (!state.contestKind)
    return (error.textContent = "Escolha o que você propõe.");
  let to = null;
  if (state.contestKind === "corrigir") {
    to = parseAmount($("#contest-amount").value);
    if (to === null) return (error.textContent = "Escreva o valor certo.");
    if (to === item.amount)
      return (error.textContent = "O valor certo é igual ao lançado.");
  }
  const reason = $("#contest-reason").value.trim();
  if (!reason) return (error.textContent = "Escreva o motivo.");

  state.votes.unshift({
    entryId: item.id,
    opener: me,
    kind: state.contestKind,
    to,
    reason,
    daysLeft: 7,
    yes: [],
    no: [],
    fresh: true,
  });
  go("vote");
}

// ---- 6. votes ---------------------------------------------------------

function proposalText(vote) {
  const item = findEntry(vote.entryId);
  const opener = vote.opener === me ? "Você quer" : `${vote.opener} quer`;
  const author = item.who === me ? "seu gasto" : `o gasto de ${item.who}`;
  return vote.kind === "arquivar"
    ? `${opener} arquivar ${author} de ${brl.format(item.amount)}.`
    : `${opener} corrigir ${author}: ${brl.format(item.amount)} para ${brl.format(vote.to)}.`;
}

function renderVotes() {
  const list = $("#vote-list");
  list.replaceChildren();
  let iVoted = false;
  for (const vote of state.votes) {
    const card = el("section", "card");
    if (vote.fresh) {
      card.append(
        el(
          "p",
          "notice",
          `Votação aberta. ${others.join(" e ")} receberam um aviso.`,
        ),
      );
    }
    const voted = vote.yes.length + vote.no.length;
    card.append(
      el("p", "vote-text", proposalText(vote)),
      el("p", "muted", `Motivo: ${vote.reason}`),
      el(
        "p",
        "muted",
        `Faltam ${vote.daysLeft} dias · ${voted} de ${VOTERS} votaram`,
      ),
    );
    const mine = vote.yes.includes(me)
      ? "concordou"
      : vote.no.includes(me)
        ? "não concordou"
        : null;
    if (mine) {
      iVoted = true;
      card.append(
        el("p", "notice", `Você ${mine}. O voto não pode ser trocado.`),
      );
    } else {
      for (const [label, cls, value] of [
        ["👍 Concordo", "primary huge", "yes"],
        ["👎 Não concordo", "secondary huge", "no"],
      ]) {
        const button = el("button", cls, label);
        button.dataset.vote = value;
        button.dataset.entry = vote.entryId;
        card.append(button);
      }
    }
    list.append(card);
  }
  if (state.votes.length === 0)
    list.append(el("p", "muted", "Nenhuma votação aberta."));

  const rules = $("#rules");
  rules.hidden = !iVoted;
  if (iVoted)
    renderRules(
      state.votes.find((v) => v.yes.includes(me) || v.no.includes(me)),
    );
}

// Shows the 2-against-1 case: everyone except the author agrees.
function renderRules(vote) {
  const item = findEntry(vote.entryId);
  const author = item.who;
  const result =
    vote.kind === "arquivar"
      ? `o gasto é arquivado e sai da conta de ${nameOf(author)}`
      : `o gasto vira ${brl.format(vote.to)}`;
  const keep =
    vote.kind === "arquivar"
      ? "o gasto continua valendo"
      : `o gasto continua ${brl.format(item.amount)}`;
  const agree = [me, ...others]
    .filter((p) => p !== author)
    .map((p) => (p === me ? "você" : p));
  if (author === me) {
    $("#rules-scenario").textContent =
      `Imagine: ${agree.join(" e ")} concordam, e você, que pagou, não concorda.`;
    $("#rule-b").textContent =
      `Também precisa do seu "sim", porque você pagou. Como você não concordou, nada muda: ${keep}.`;
  } else {
    $("#rules-scenario").textContent =
      `Imagine: ${agree.join(" e ")} concordam, e ${author}, que pagou, não concorda.`;
    $("#rule-b").textContent =
      `Também precisa do "sim" de ${author}, que pagou. Como ${author} não concordou, nada muda: ${keep}.`;
  }
  $("#rule-a").textContent =
    `2 votos de 3 bastam. A proposta é aprovada e ${result}.`;
}

function castVote(entryId, agree) {
  const vote = openVoteFor(entryId);
  (agree ? vote.yes : vote.no).push(me);
  vote.fresh = false;
  renderVotes();
}

// ---- wiring -----------------------------------------------------------

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.go) return go(target.dataset.go);
  if (target.dataset.vote)
    return castVote(
      Number(target.dataset.entry),
      target.dataset.vote === "yes",
    );
  if (target.dataset.entry) return showEntry(Number(target.dataset.entry));

  const choiceGroup = target.closest(".choices");
  if (choiceGroup && target.classList.contains("choice")) {
    pick(choiceGroup, target);
    const value = target.dataset.value;
    if (choiceGroup.id === "category") state.form.category = value;
    if (choiceGroup.id === "invoice") state.form.invoice = value;
    if (choiceGroup.id === "contest-kind") {
      state.contestKind = value;
      $("#contest-amount-box").hidden = value !== "corrigir";
    }
    return;
  }

  const actions = {
    "new-expense": startExpense,
    save,
    "photo-ok": acceptPhoto,
    "photo-retry": () => go("expense"),
    undo: () => {
      $("#undo-box").hidden = false;
      $("#undo-reason").focus();
    },
    "undo-confirm": undoFromConfirmation,
    "entry-undo": () => {
      $("#entry-undo-box").hidden = false;
      $("#entry-undo-reason").focus();
    },
    "entry-undo-confirm": undoFromDetail,
    contest: startContest,
    "contest-open": openVote,
  };
  actions[target.dataset.action]?.();
});

// Typing again clears the error shown on that screen.
document.addEventListener("input", (event) => {
  const error = event.target.closest(".screen")?.querySelector(".error");
  if (error) error.textContent = "";
});

for (const input of document.querySelectorAll(".photo-input")) {
  input.addEventListener("change", (event) => {
    onPhoto(event.target.files[0]);
    event.target.value = "";
  });
}

// Keep the fragment out of the address bar after reading it, so a
// screenshot of the page does not show the family's names.
window.history.replaceState(null, "", window.location.pathname);
go("home");
