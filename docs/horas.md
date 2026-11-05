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

## Total por bloco

| Bloco | Estimado | Real |
|-------|----------|------|
| 0. Validação e base | 18 h | 10,5 h |
| 1A. Domínio dos sócios | 18 h | |
| 2A. Persistência dos sócios | 15 h | |
| Infra de produção | 12 h | |
| Versão para os sócios | 30 h | |
| Importação da planilha | 3 h | |
