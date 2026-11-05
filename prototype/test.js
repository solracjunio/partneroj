/* global document, window, navigator, sessionStorage, crypto, fetch, performance, setInterval, MutationObserver, params, me, others, go */
// Guided test for one partner. It only runs when the link has a
// secret token (#...&teste=TOKEN); without it the prototype sends nothing.
//
// What it records: task times, screens, which buttons were tapped (by their
// role, never by the names written on them), error messages, the phone
// model and the final answers. Never photos, typed amounts or names.
const token = params.get("teste");

if (token) startGuidedTest(token);

function startGuidedTest(token) {
  const ENDPOINT = "/coleta";
  const SAVED = "prototype-test";

  const tasks = [
    {
      id: "gasto",
      short: "Lance o gasto de R$ 350,00 com a foto da nota",
      text: "Você comprou R$ 350,00 de cimento. Lance esse gasto com a foto da nota. Pode tirar a foto de qualquer papel.",
      doneOn: "expense-saved",
    },
    {
      id: "votar",
      short: "Dê o seu voto na votação aberta",
      text: `${others[0]} abriu uma votação sobre um gasto de ${others[1]}. Encontre a votação e dê o seu voto.`,
      doneOn: "voted",
    },
    {
      id: "discordar",
      short: `Peça a correção do gasto de ${others[0]}`,
      text: `${others[0]} lançou R$ 1.200,00 de material, mas você sabe que a nota era de R$ 1.100,00. Mostre que você discorda e peça a correção.`,
      doneOn: "vote-opened",
    },
    {
      id: "acerto",
      short: "Faça o acerto final e veja quanto você recebe",
      text: "A obra terminou e a casa foi vendida. Anuncie o acerto final e descubra quanto você vai receber.",
      doneOn: "settled",
    },
  ];

  // Progress survives a reload: Android may reload the page after the camera.
  const saved = JSON.parse(sessionStorage.getItem(SAVED) || "null");
  const test = saved ?? {
    session: crypto.randomUUID(),
    phase: "intro", // intro → task → questions → free
    task: 0,
    taskDone: false,
  };
  const save = () => sessionStorage.setItem(SAVED, JSON.stringify(test));
  const started = performance.now();
  let queue = [];
  let taskStartedAt = null;

  const $ = (selector) => document.querySelector(selector);
  const visibleScreen = () =>
    [...document.querySelectorAll(".screen")].find((s) => !s.hidden)?.id;

  function record(type, detail = {}) {
    queue.push({
      type,
      t: Math.round(performance.now() - started),
      phase: test.phase,
      task: test.phase === "task" ? tasks[test.task].id : undefined,
      ...detail,
    });
  }

  // fetch with keepalive still sends while the page is closing.
  function flush() {
    if (queue.length === 0) return;
    const body = JSON.stringify({
      token,
      session: test.session,
      events: queue,
    });
    queue = [];
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
  setInterval(flush, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  // ---- what happened ---------------------------------------------------

  // A button is described by its role, never by its text (texts have names).
  function describe(node) {
    // Tapping a field (or its label, which forwards the tap) is not a miss.
    if (node.matches("input, textarea")) return `campo:${node.id || node.type}`;
    if (node.id === "task-bar-button")
      return test.taskDone ? "teste:continuar" : "teste:pular";
    const button = node.closest("button, label.photo-button");
    if (!button) {
      return `vazio:${node.tagName.toLowerCase()}${node.className ? "." + String(node.className).split(" ")[0] : ""}`;
    }
    const d = button.dataset;
    if (button.matches("label.photo-button"))
      return button.querySelector("[capture]") ? "foto:camera" : "foto:galeria";
    if (d.action) return `acao:${d.action}`;
    if (d.go) return `ir:${d.go}`;
    if (d.test) return `teste:${d.test}`;
    if (d.vote) return `voto:${d.vote}`;
    if (d.transfer) return "pix:recebi";
    if (d.pix) return "pix:copiar";
    if (d.entry) return "lancamento";
    if (button.id) return `botao:${button.id}`;
    const group = button.closest(".choices")?.id;
    // Invoice choices are names, so only the group is recorded.
    if (group === "invoice") return "escolha:invoice";
    if (group) return `escolha:${group}:${d.value}`;
    return "botao";
  }

  document.addEventListener(
    "click",
    (event) =>
      record("toque", { tela: visibleScreen(), alvo: describe(event.target) }),
    true,
  );

  // Error messages are fixed texts written in app.js, with no amounts.
  for (const box of document.querySelectorAll(".error")) {
    new MutationObserver(() => {
      if (box.textContent)
        record("erro", { tela: visibleScreen(), texto: box.textContent });
    }).observe(box, { childList: true, characterData: true, subtree: true });
  }

  document.addEventListener("prototype", (event) => {
    const { name, ...detail } = event.detail;
    record(name, detail);
    const task = tasks[test.task];
    if (test.phase === "task" && !test.taskDone && name === task.doneOn) {
      test.taskDone = true;
      save();
      record("tarefa-concluida", { segundos: secondsInTask() });
      flush();
      showBar();
    }
  });

  // ---- flow -------------------------------------------------------------

  const secondsInTask = () =>
    taskStartedAt === null
      ? null
      : Math.round((performance.now() - taskStartedAt) / 1000);

  function showBar() {
    const bar = $("#task-bar");
    const inTask = test.phase === "task";
    bar.hidden = !inTask;
    document.body.classList.toggle("testing", inTask);
    if (!inTask) return;
    bar.classList.toggle("done", test.taskDone);
    $("#task-bar-text").textContent = test.taskDone
      ? "✅ Tarefa concluída!"
      : `Tarefa ${test.task + 1} de ${tasks.length}: ${tasks[test.task].short}`;
    $("#task-bar-button").textContent = test.taskDone ? "Continuar ›" : "Pular";
  }

  function showTask() {
    const task = tasks[test.task];
    $("#test-task-title").textContent =
      `Tarefa ${test.task + 1} de ${tasks.length}`;
    $("#test-task-text").textContent = task.text;
    showBar();
    go("test-task");
  }

  function beginTask() {
    test.phase = "task";
    test.taskDone = false;
    save();
    taskStartedAt = performance.now();
    record("tarefa-inicio");
    showBar();
    go("home");
  }

  function nextTask(skipped) {
    if (skipped) record("tarefa-pulada", { segundos: secondsInTask() });
    flush();
    taskStartedAt = null;
    test.task += 1;
    test.phase = test.task < tasks.length ? "between" : "questions";
    save();
    showBar();
    if (test.phase === "questions") go("test-questions");
    else showTask();
  }

  function sendAnswers() {
    const ease = $("#test-ease .selected")?.dataset.value;
    if (!ease) {
      $("#test-error").textContent = "Escolha uma resposta na pergunta 1.";
      return;
    }
    record("respostas", {
      facilidade: ease,
      dificil: $("#test-hard").value.trim().slice(0, 1000),
      gostaria: $("#test-wish").value.trim().slice(0, 1000),
    });
    test.phase = "free";
    save();
    flush();
    go("test-thanks");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "task-bar-button") return nextTask(!test.taskDone);
    const action = {
      start: showTask,
      "begin-task": beginTask,
      answers: sendAnswers,
      explore: () => go("home"),
    }[button.dataset.test];
    action?.();
  });

  // ---- start ------------------------------------------------------------

  $("#footnote").textContent =
    "Teste: registra tempos, toques e respostas. Nunca fotos nem valores.";
  $("#test-hello").textContent = `Olá, ${me}!`;

  if (saved) {
    record("recarregou", { tela: visibleScreen() });
  } else {
    // Chrome hides the model in the user agent; the client hints have it.
    const device = {
      ua: navigator.userAgent,
      largura: window.innerWidth,
      altura: window.innerHeight,
      escala: window.devicePixelRatio,
    };
    record("inicio", device);
    navigator.userAgentData
      ?.getHighEntropyValues(["model", "platformVersion"])
      .then((hints) =>
        record("aparelho", {
          modelo: hints.model,
          android: hints.platformVersion,
        }),
      )
      .catch(() => {});
  }

  if (test.phase === "intro") go("test-intro");
  else if (test.phase === "between") showTask();
  else if (test.phase === "task") {
    // A reload restarts the clock of the current task.
    taskStartedAt = performance.now();
    showBar();
  } else if (test.phase === "questions") go("test-questions");
  // "free" stays on the home screen.
}
