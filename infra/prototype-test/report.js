// Turns a collected file into a readable report, on your own computer:
//   scp partneroj:~/prototype-test/data/<label>.jsonl /tmp/ && node report.js /tmp/<label>.jsonl
import { readFileSync } from "node:fs";
import process from "node:process";

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: node report.js <file.jsonl>\n");
  process.exit(1);
}

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const sessions = new Map();
for (const line of lines) {
  const { recebido, sessao, events } = JSON.parse(line);
  if (!sessions.has(sessao))
    sessions.set(sessao, { first: recebido, events: [] });
  sessions.get(sessao).events.push(...events);
}

const out = (text = "") => process.stdout.write(`${text}\n`);
const mmss = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

for (const [id, { first, events }] of sessions) {
  events.sort((a, b) => a.t - b.t);
  out(`# Sessão ${id.slice(0, 8)} (primeiro envio: ${first})`);
  for (const e of events.filter(
    (e) => e.type === "inicio" || e.type === "aparelho",
  )) {
    out(
      `- ${e.type}: ${JSON.stringify({ ...e, type: undefined, t: undefined, phase: undefined })}`,
    );
  }
  out(
    `- recarregou a página: ${events.filter((e) => e.type === "recarregou").length}x`,
  );
  out();
  out("## Tarefas");
  out(
    "| tarefa | resultado | segundos | toques | toques fora de botão | erros |",
  );
  out("|---|---|---|---|---|---|");
  for (const task of [...new Set(events.map((e) => e.task).filter(Boolean))]) {
    const mine = events.filter((e) => e.task === task);
    const done = mine.find((e) => e.type === "tarefa-concluida");
    const skipped = mine.find((e) => e.type === "tarefa-pulada");
    const taps = mine.filter((e) => e.type === "toque");
    out(
      `| ${task} | ${done ? "concluída" : skipped ? "pulada" : "incompleta"} | ${(done ?? skipped)?.segundos ?? "?"} | ${taps.length} | ${taps.filter((e) => e.alvo.startsWith("vazio:")).length} | ${
        mine
          .filter((e) => e.type === "erro")
          .map((e) => e.texto)
          .join("; ") || "-"
      } |`,
    );
  }
  out();
  out("## Caminho de cada tarefa");
  for (const task of [...new Set(events.map((e) => e.task).filter(Boolean))]) {
    const path = events
      .filter(
        (e) => e.task === task && (e.type === "toque" || e.type === "erro"),
      )
      .map((e) => (e.type === "erro" ? `⚠️"${e.texto}"` : e.alvo));
    out(`- **${task}:** ${path.join(" → ")}`);
  }
  out();
  for (const a of events.filter((e) => e.type === "respostas")) {
    out("## Respostas");
    out(`- Foi fácil? ${a.facilidade}`);
    out(`- Mais difícil ou confuso: ${a.dificil || "(em branco)"}`);
    out(`- Gostaria que tivesse: ${a.gostaria || "(em branco)"}`);
    out();
  }
  const free = events.filter((e) => e.phase === "free");
  if (free.length) {
    const screens = free.filter((e) => e.type === "screen").map((e) => e.id);
    out("## Uso livre");
    out(
      `- duração: ${mmss(free.at(-1).t - free[0].t)}, ${free.filter((e) => e.type === "toque").length} toques`,
    );
    out(`- telas: ${screens.join(" → ") || "-"}`);
    out();
  }
}
