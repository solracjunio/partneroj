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

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const $ = (selector) => document.querySelector(selector);

const state = {
  totals: { [me]: 12400, [others[0]]: 11200, [others[1]]: 12100 },
  feed: [
    {
      who: others[0],
      amount: 1200,
      category: "Material",
      when: "ontem",
      photo: true,
    },
    {
      who: others[1],
      amount: 350,
      category: "Material",
      when: "há 2 dias",
      photo: true,
    },
    { who: me, amount: 480, category: "Taxas", when: "há 3 dias", photo: true },
  ],
  form: { category: null, invoice: invoiceDefault, photoUrl: null },
  startedAt: null,
  lastEntry: null,
  voted: false,
};

// ---- navigation -------------------------------------------------------

function go(id) {
  for (const screen of document.querySelectorAll(".screen")) {
    screen.hidden = screen.id !== id;
  }
  window.scrollTo(0, 0);
  const render = { home: renderHome, feed: renderFeed, vote: renderVote }[id];
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
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name === me ? `${name} (você)` : name;
    const value = document.createElement("strong");
    value.textContent = brl.format(state.totals[name]);
    item.append(label, value);
    list.append(item);
  }
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
    const button = document.createElement("button");
    button.className = "choice";
    button.dataset.value = name;
    button.textContent = name === me ? "No meu nome" : name;
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
  const entry = {
    who: me,
    amount,
    category: state.form.category,
    when: "agora",
    photo: true,
    invoice: state.form.invoice,
  };
  state.feed.unshift(entry);
  state.totals[me] += amount;
  state.lastEntry = entry;

  $("#done-amount").textContent = brl.format(amount);
  const invoiceName =
    entry.invoice === me ? "no seu nome" : `no nome de ${entry.invoice}`;
  $("#done-detail").textContent = `${entry.category} · nota ${invoiceName}`;
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

// ---- 4. undo ----------------------------------------------------------

function undo() {
  const reason = $("#undo-reason").value.trim();
  if (!reason) return ($("#undo-error").textContent = "Escreva o motivo.");
  state.lastEntry.undone = reason;
  state.totals[me] -= state.lastEntry.amount;
  $("#undo-box").hidden = true;
  $("#done-notified").textContent =
    `Desfeito. ${others.join(" e ")} receberam um aviso.`;
  setTimeout(() => go("feed"), 1500);
}

// ---- 5. feed ----------------------------------------------------------

function renderFeed() {
  const list = $("#feed-list");
  list.replaceChildren();
  for (const entry of state.feed) {
    const item = document.createElement("li");
    const what = document.createElement("p");
    what.className = entry.undone ? "what undone" : "what";
    const who = entry.who === me ? "Você" : entry.who;
    what.textContent = `${who} lançou ${brl.format(entry.amount)}`;
    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${entry.category} · ${entry.when}${entry.photo ? " · 📷 nota" : ""}`;
    item.append(what, detail);
    if (entry.undone) {
      const why = document.createElement("p");
      why.className = "muted";
      why.textContent = `Desfeito: ${entry.undone}`;
      item.append(why);
    }
    list.append(item);
  }
}

// ---- 6. vote ----------------------------------------------------------

// Scenario: others[0] wants to correct an expense that others[1] paid.
function renderVote() {
  const [opener, author] = others;
  $("#vote-text").textContent =
    `${opener} quer corrigir o gasto de ${author}: ${brl.format(350)} para ${brl.format(305)}.`;
  $("#vote-reason").textContent = "Motivo: a nota da loja é de R$ 305,00.";
  const votes = state.voted ? 2 : 1;
  $("#vote-status").textContent = `Faltam 5 dias · ${votes} de 3 votaram`;
  $("#vote-buttons").hidden = state.voted;
  $("#rules").hidden = !state.voted;

  $("#rules-scenario").textContent =
    `Imagine: você e ${opener} concordam, e ${author}, que pagou, não concorda.`;
  $("#rule-a").textContent =
    "2 votos de 3 bastam. A correção é aprovada e o gasto vira R$ 305,00.";
  $("#rule-b").textContent =
    `Também precisa do "sim" de ${author}, que pagou. Como ${author} não concordou, nada muda: o gasto continua R$ 350,00.`;
}

function vote(agree) {
  state.voted = true;
  const thanks = $("#vote-thanks");
  thanks.textContent = agree
    ? "Você concordou. Obrigado!"
    : "Você não concordou. Obrigado!";
  thanks.hidden = false;
  renderVote();
}

// ---- wiring -----------------------------------------------------------

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.go) return go(target.dataset.go);

  const choiceGroup = target.closest(".choices");
  if (choiceGroup && target.classList.contains("choice")) {
    pick(choiceGroup, target);
    if (choiceGroup.id === "category")
      state.form.category = target.dataset.value;
    if (choiceGroup.id === "invoice") state.form.invoice = target.dataset.value;
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
    "undo-confirm": undo,
    "vote-yes": () => vote(true),
    "vote-no": () => vote(false),
  };
  actions[target.dataset.action]?.();
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
