/* global document, window, navigator, sessionStorage, URL, URLSearchParams, setTimeout */
// Clickable prototype for the block 0 test. Everything lives in memory:
// nothing is saved on a server and the photo never leaves the phone.
//
// Real names never go in git. They come in the link fragment, which the
// browser does not send to the server:
//   /prototipo/#eu=Name&outros=Name2,Name3&nota=Name2&meta=50000&venda=60000&recebeu=Name2&t=1
// meta is each partner's goal in reals (a real amount, so also not in git).
// venda is the sale price in reals and recebeu who got the money, both used
// by the final settlement.
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
const SALE = Number(params.get("venda")) || 60000;
const saleWho = [me, ...others].includes(params.get("recebeu"))
  ? params.get("recebeu")
  : invoiceDefault;
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
  // Final settlement: null, then "announced", then "done".
  final: null,
  transfers: [],
};

const findEntry = (id) => state.feed.find((e) => e.id === id);
// One vote per entry, ever: after a rejection the entry cannot be contested again.
const voteFor = (id) => state.votes.find((v) => v.entryId === id);
// A vote that runs out of time is rejected: whoever did not vote counts as "no".
const isRejected = (vote) => vote.no.length > 0 || Boolean(vote.expired);
const isOpen = (vote) => !isRejected(vote) && vote.yes.length < VOTERS;
const voteLabel = (vote) =>
  isOpen(vote)
    ? "🗳️ Em votação"
    : isRejected(vote)
      ? "❌ Votação rejeitada"
      : "✅ Votação aprovada";
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
    settle: renderSettle,
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
  const open = state.votes.filter(isOpen).length;
  $('[data-go="vote"]').firstChild.textContent = `Votações abertas (${open}) `;

  const banner = $("#home-final");
  banner.hidden = !state.final;
  banner.textContent =
    state.final === "done"
      ? "✅ O acerto final está pronto. Veja quem paga quem."
      : "📣 Acerto final anunciado: sai em 7 dias.";
  // After the settlement the project is closed: no new expenses.
  $('[data-action="new-expense"]').hidden = state.final === "done";
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
    const vote = voteFor(item.id);
    if (vote)
      button.append(
        el("p", isOpen(vote) ? "status" : "status rejected", voteLabel(vote)),
      );
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
  const vote = voteFor(item.id);
  $("#entry-title").textContent =
    `${nameOf(item.who)} lançou ${brl.format(item.amount)}`;
  $("#entry-detail").textContent =
    `${item.category} · ${item.when} · 📷 foto da nota`;

  const status = $("#entry-status");
  status.hidden = !(item.undone || vote);
  if (item.undone) status.textContent = `Desfeito: ${item.undone}`;
  else if (vote && isOpen(vote)) {
    status.textContent =
      "🗳️ Em votação. Ele continua contando nos saldos até o fim.";
  } else if (vote)
    status.textContent = `${voteLabel(vote)}. Não pode ser contestado de novo.`;
  else if (state.final) {
    status.hidden = false;
    status.textContent =
      "📣 O acerto final foi anunciado: não dá para abrir votação nova.";
  }

  const mine = item.who === me;
  // Plan rules: the author undoes their own entry; others contest it.
  // No vote on an undone entry, and only one open vote per entry.
  // Plan, section 3: after the announcement nobody opens a new vote, and
  // after the settlement nothing changes.
  $("#entry-undo").hidden =
    !mine || Boolean(item.undone) || Boolean(vote) || state.final === "done";
  $("#entry-contest").hidden =
    mine || Boolean(item.undone) || Boolean(vote) || Boolean(state.final);
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

// Partners' rule (ADR 0004): unanimity. Every partner, the author included,
// must agree; the first "no" ends the vote and nothing changes.
function renderVotes() {
  const list = $("#vote-list");
  list.replaceChildren();
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
    card.append(
      el("p", "vote-text", proposalText(vote)),
      el("p", "muted", `Motivo: ${vote.reason}`),
    );

    const everyone = [me, ...others];
    const against = vote.no[0];
    const missing = everyone.filter((p) => !vote.yes.includes(p));
    if (vote.expired) {
      const names = missing.map((p) => (p === me ? "você" : p)).join(" e ");
      card.append(
        el(
          "p",
          "status rejected",
          `❌ Rejeitada: o prazo acabou sem o "sim" de ${names}. Nada muda.`,
        ),
      );
    } else if (against) {
      card.append(
        el(
          "p",
          "status rejected",
          `❌ Rejeitada: ${against === me ? "você" : against} não concordou. Nada muda.`,
        ),
      );
    } else if (missing.length === 0) {
      card.append(el("p", "status", "✅ Aprovada: os 3 concordaram."));
    } else {
      const names = missing.map((p) => (p === me ? "você" : p)).join(" e ");
      card.append(
        el(
          "p",
          "muted",
          `Faltam ${vote.daysLeft} dias · ${vote.yes.length} de ${VOTERS} concordaram`,
        ),
        el("p", "muted", `Falta o "sim" de: ${names}`),
      );
    }

    const myVote = vote.yes.includes(me)
      ? "concordou"
      : vote.no.includes(me)
        ? "não concordou"
        : null;
    if (myVote) {
      card.append(
        el("p", "notice", `Você ${myVote}. O voto não pode ser trocado.`),
      );
    } else if (!isRejected(vote)) {
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
}

function castVote(entryId, agree) {
  const vote = voteFor(entryId);
  (agree ? vote.yes : vote.no).push(me);
  vote.fresh = false;
  renderVotes();
}

// ---- 9. final settlement --------------------------------------------

const cents = (reais) => Math.round(reais * 100);

// Plan, section 3: split by integer weights with the largest remainder.
// Ties go by the order drawn once when the project was created, so the
// spare cent always goes to the same person. The sign is applied at the end.
const WEIGHTS = [1, 1, 1];
const DRAW = [2, 0, 1]; // indexes into [me, ...others], drawn at creation

function splitByWeights(value, weights, draw) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const abs = Math.abs(value);
  const parts = weights.map((w) => Math.floor((abs * w) / sum));
  const rest = weights.map((w) => (abs * w) % sum);
  let left = abs - parts.reduce((a, b) => a + b, 0);
  // Array.prototype.sort is stable, so equal remainders keep the draw order.
  for (const i of [...draw].sort((a, b) => rest[b] - rest[a])) {
    if (left-- <= 0) break;
    parts[i] += 1;
  }
  return parts.map((part) => (value < 0 ? -part : part));
}

// Greedy debt simplification: the biggest debtor pays the biggest creditor.
// At most n - 1 transfers; the exact search comes in block 1B.
function simplify(balances) {
  const people = Object.entries(balances).map(([name, value]) => ({
    name,
    value,
  }));
  const transfers = [];
  for (;;) {
    people.sort((a, b) => a.value - b.value);
    const debtor = people[0];
    const creditor = people[people.length - 1];
    if (debtor.value >= 0 || creditor.value <= 0) break;
    const amount = Math.min(-debtor.value, creditor.value);
    transfers.push({ from: debtor.name, to: creditor.name, amount });
    debtor.value += amount;
    creditor.value -= amount;
  }
  return transfers;
}

function computeSettlement() {
  const everyone = [me, ...others];
  const put = everyone.map((name) => cents(state.totals[name]));
  const spent = put.reduce((a, b) => a + b, 0);
  const sale = cents(SALE);
  const profit = sale - spent;
  const shares = splitByWeights(profit, WEIGHTS, DRAW);
  const balances = {};
  // Saldo = what you put in − what you got in your pocket + your share.
  everyone.forEach((name, i) => {
    balances[name] = put[i] - (name === saleWho ? sale : 0) + shares[i];
  });
  return { everyone, put, spent, sale, profit, shares, balances };
}

function announce() {
  state.final = "announced";
  renderSettle();
}

// Prototype only: jump to the end of the 7 days. Open votes reach their
// deadline, so whoever did not vote counts as "no" (ADR 0004).
function skipWeek() {
  for (const vote of state.votes.filter(isOpen)) vote.expired = true;
  state.final = "done";
  state.transfers = simplify(computeSettlement().balances).map((t) => ({
    ...t,
    received: false,
  }));
  renderSettle();
}

function row(label, value, strong) {
  const item = el("li");
  item.append(el("span", "", label), el(strong ? "strong" : "span", "", value));
  return item;
}

function renderSettle() {
  const body = $("#settle-body");
  body.replaceChildren();

  if (!state.final) {
    const card = el("section", "card");
    card.append(
      el("h2", "", "A obra terminou?"),
      el(
        "p",
        "",
        "O acerto devolve a cada um o que colocou e divide o lucro em partes iguais.",
      ),
      el("p", "muted", "Depois do anúncio, ninguém abre votação nova."),
      el(
        "p",
        "muted",
        "O acerto sai em 7 dias, quando as votações abertas terminarem.",
      ),
    );
    const button = el("button", "primary huge", "Anunciar o acerto final");
    button.dataset.action = "announce";
    body.append(
      card,
      button,
      el("p", "muted center", "Os 3 sócios recebem um aviso."),
    );
    return;
  }

  if (state.final === "announced") {
    const open = state.votes.filter(isOpen).length;
    const card = el("section", "card");
    card.append(
      el("p", "notice", "📣 Acerto final anunciado. Sai em 7 dias."),
      el(
        "p",
        "muted",
        open
          ? `Votações abertas: ${open}. O acerto espera elas terminarem.`
          : "Nenhuma votação aberta.",
      ),
      el("p", "muted", "Ainda dá para lançar os últimos gastos."),
    );
    const button = el("button", "secondary huge", "Protótipo: pular 7 dias");
    button.dataset.action = "skip-week";
    body.append(card, button);
    return;
  }

  const s = computeSettlement();
  const money = (value) => brl.format(value / 100);
  const label = s.profit >= 0 ? "Lucro" : "Prejuízo";

  const summary = el("section", "card");
  const lines = el("ul", "people");
  lines.append(
    row(`Venda (recebida por ${nameOf(saleWho)})`, money(s.sale)),
    row("Gastos da obra", `− ${money(s.spent)}`),
    row(label, money(s.profit), true),
  );
  summary.append(el("h2", "", "Resultado da obra"), lines);

  const each = el("section", "card");
  const list = el("ul", "people");
  s.everyone.forEach((name, i) => {
    const item = el("li", "stacked");
    const head = el("div", "line");
    head.append(
      el("span", "", name === me ? `${name} (você)` : name),
      el("strong", "", money(s.put[i] + s.shares[i])),
    );
    item.append(
      head,
      el(
        "p",
        "muted",
        `colocou ${money(s.put[i])} ${s.shares[i] < 0 ? "−" : "+"} ${label.toLowerCase()} ${money(Math.abs(s.shares[i]))}`,
      ),
    );
    list.append(item);
  });
  each.append(el("h2", "", "Quanto cada um recebe no total"), list);

  const pay = el("section", "card");
  pay.append(el("h2", "", "Quem paga quem"));
  state.transfers.forEach((t, i) => {
    const box = el("div", "transfer");
    const from = t.from === me ? "Você manda" : `${t.from} manda`;
    const to = t.to === me ? "você" : t.to;
    box.append(el("p", "vote-text", `${from} ${money(t.amount)} para ${to}`));
    if (t.received) {
      box.append(
        el("p", "status", `✅ ${t.to === me ? "Você" : t.to} recebeu.`),
      );
    } else if (t.to === me) {
      const button = el("button", "primary huge", "✅ Já recebi");
      button.dataset.transfer = i;
      box.append(button);
    } else if (t.from === me) {
      const button = el(
        "button",
        "secondary huge",
        `Copiar a chave Pix de ${t.to}`,
      );
      button.dataset.pix = i;
      box.append(
        button,
        el("p", "muted", `Esperando ${t.to} confirmar que recebeu.`),
      );
    } else {
      box.append(el("p", "muted", `Esperando ${t.to} confirmar que recebeu.`));
    }
    pay.append(box);
  });
  if (state.transfers.length === 0)
    pay.append(el("p", "muted", "Ninguém precisa pagar ninguém."));
  else if (state.transfers.every((t) => t.received))
    pay.append(
      el("p", "notice", "🎉 Acerto concluído. A obra está encerrada."),
    );

  body.append(summary, each, pay);
}

function confirmReceived(index) {
  state.transfers[index].received = true;
  renderSettle();
}

function copyPix(button) {
  // The real app copies the partner's Pix key; the prototype has none.
  navigator.clipboard?.writeText("chave-pix-de-exemplo").catch(() => {});
  button.textContent = "Chave Pix copiada ✓";
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
  if (target.dataset.transfer)
    return confirmReceived(Number(target.dataset.transfer));
  if (target.dataset.pix) return copyPix(target);
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
    announce,
    "skip-week": skipWeek,
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
// screenshot of the page does not show the partners' names.
window.history.replaceState(null, "", window.location.pathname);
go("home");
