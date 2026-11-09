# Registro de horas

Horas reais, medidas com timer e sem arredondar. Servem para recalcular o cronograma e medir o ganho do uso de IA.

As linhas marcadas com * foram estimadas pelo log da sessão com o Claude (pausas de mais de 15 minutos não contam), porque o timer ainda não estava em uso.

| Data | Bloco | Horas | O que foi feito | IA ajudou? |
|------|-------|-------|-----------------|------------|
| 31/10/2026 | 0 | 1,5 h* | Agentes de validação e skill `/validar-ideia`; rodadas 1 a 3; IDEIA v2, v3 e v4 | Sim |
| 01/11/2026 | 0 | 1,0 h* | Organização do repositório e git; README em inglês; ADR 0001 e glossário | Sim |
| 01/11/2026 | 0 | 1,0 h | Conversa com os sócios por WhatsApp (roteiro feito com IA) | Sim |
| 01/11/2026 | 0 | 0,5 h* | Roteiro da conversa e revisão das respostas dos sócios | Sim |
| 01/11/2026 | 0 | 1,0 h* | ADR 0002 (pesos e maior resto), escrito em conversa com a IA | Sim |
| 02/11/2026 | 0 | 0,75 h* | ADR 0003 (uso de IA), escrito em conversa com a IA | Sim |
| 04/11/2026 | 0 | 2,5 h* | Monorepo: devbox (Node 26, pnpm 12), raiz do workspace, packages domain e contracts, apps api, worker e web, Postgres no Compose; repositório movido para ~/projetos | Sim |
| 04/11/2026 | 0 | 0,75 h* | Repositório público no GitHub: varredura de dados sensíveis, e-mail noreply e valores ilustrativos no ADR 0002 (histórico reescrito antes do push); gh, ajustes no .bashrc e terminal no Maestri | Sim |
| 04/11/2026 | 0 | 0,25 h* | CI no GitHub Actions (format, build, lint, typecheck e testes), PR #1 e proteção do `main` | Sim |
| 04/11/2026 | 0 | 1,0 h* | Comparativo de hospedagem (Hostinger, Hetzner, Magalu, Contabo, Oracle, AWS, Heroku, PC próprio) e decisão; VPS Hostinger KVM 1 em SP e `partneroj.com.br`; servidor protegido (usuário sem root, SSH só por chave, ufw), Docker e DNS com DNSSEC | Sim |
| 05/11/2026 | 0 | 0,25 h* | Teste de fumaça: HTTPS com Caddy e Let's Encrypt e push VAPID chegando no celular (Brave) | Sim |
| 05/11/2026 | 0 | 1,25 h* | CI bloqueada por orçamento de $0 no GitHub (diagnóstico e ajuste); correção de SSRF e limite de inscrições no teste de push; merges e retirada do serviço de push da VPS | Sim |
| 05/11/2026 | 0 | 1,0 h* | Protótipo clicável em HTML (8 telas) no ar em `/prototipo/`, teste do desenvolvedor (27 s) e ajustes; telas para contestar lançamento; regra de votação por unanimidade (ADR 0004) | Sim |
| 05/11/2026 | 0 | 0,5 h* | Tela do acerto final no protótipo: anúncio com 7 dias, divisão do lucro pelo maior resto e Pix sugeridos | Sim |
| 05/11/2026 | 0 | 1,0 h* | Teste guiado no protótipo (4 tarefas, 3 perguntas e uso livre) com coletor na VPS por token secreto e relatório; revisão de privacidade nos textos dos PRs | Sim |
| 05/11/2026 | 0 | 0,75 h* | Revisão de privacidade: termos trocados por "sócios" nos arquivos, PRs e commits, e histórico do `main` reescrito; leitura do resultado do teste guiado; correção da tabela de aparelhos; quiz do bloco 0 (4/5) | Sim |
| 05/11/2026 | 1A | 1,0 h* | `packages/domain` em TDD com testes de propriedade: rateio por pesos e maior resto com negativos (PR #9), fórmula do saldo e regra de ouro (PR #10), regras do estorno, status derivado e totais por categoria (PR #11) | Sim |
| 05/11/2026 | 1A | 1,0 h* | Resumo do bloco para entrevista; ADRs 0005 a 0007 (centavos em `bigint`, estorno e abertura), escritos em conversa com a IA; quiz do bloco 1A (2/5) e resumo de resultado × contribuição | Sim |
| 07/11/2026 | 2A | 2,5 h* | `packages/db` com Drizzle e Testcontainers (Postgres 18): sociedades, membros, projetos e pesos (PR #14); nomes do domínio alinhados ao glossário, `Weight` e `resultPart` (PR #15); lançamentos, contas e categorias, com estorno único e motivo obrigatório (PR #16); trigger que recusa `UPDATE`, `DELETE` e `TRUNCATE` em lançamentos (PR #17); prova do pg-boss na transação, com rollback desfazendo o job (PR #18). Bloco em modo Learning: as restrições, o trigger e o `send` na transação foram escritos pelo desenvolvedor | Sim |
| 07/11/2026 | 2A | 1,0 h* | Comprovantes (tipo, tamanho e SHA-256), convites e sessões só com hash do token, e `consumeInvite` atômico contra dois toques simultâneos (PR #20); feed de atividades com marcação de leitura, auditoria só de inserção por trigger e `recordEntry` gravando lançamento, feed, auditoria e job numa transação (PR #21). Modo Learning: as condições do convite, o trigger da auditoria e a linha do feed foram escritos pelo desenvolvedor; quiz do bloco 2A (3/5) | Sim |
| 08/11/2026 | Infra | 1,5 h* | Papel de banco restrito `partneroj_app` (sem alterar ou apagar lançamentos e auditoria) e pg-boss instalado pelo dono (PR #23); compose de produção com Caddy, passo de migração e `deploy.sh`, primeiro deploy na VPS (PR #24); backup diário com restic, papéis do cluster, retenção e teste de restauração num Postgres descartável que confere lançamentos e auditoria por hash (PR #25) | Sim |
| 08/11/2026 | Infra | 2,75 h* | Uptime Kuma com ntfy e painel só por túnel SSH, heartbeat dos backups e queda simulada avisada (PR #26); correção do `deploy.sh` que parava sem erro e da retenção que apagava o backup pré-deploy (PR #27); cópia para o PC de casa por WireGuard e rest-server append-only, com tentativa de apagar recusada (PR #28); chaves VAPID e vigilância de fora da VPS pelo Healthchecks.io (PR #29); quiz do bloco Infra (3/5) | Sim |

## Total por bloco

| Bloco | Estimado | Real |
|-------|----------|------|
| 0. Validação e base | 18 h | 15,0 h |
| 1A. Domínio dos sócios | 18 h | 2,0 h |
| 2A. Persistência dos sócios | 15 h | 3,5 h |
| Infra de produção | 12 h | 4,25 h |
| Versão para os sócios | 30 h | |
| Importação da planilha | 3 h | |
