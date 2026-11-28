# Instruções para agentes

Vale para qualquer agente de código (Claude Code, Codex e outros). O `CLAUDE.md` só importa este arquivo.

Visão geral do projeto no [`README.md`](README.md); decisões em [`docs/adr/`](docs/adr/). Docs em português, código, commits e PRs em inglês ([ADR 0001](docs/adr/0001-idioma-do-projeto.md)).

## Ambiente

Abra o agente na raiz do repositório, dentro do ambiente do devbox (`devbox shell`). As versões de Node, pnpm e das ferramentas abaixo vêm fixas no [`devbox.json`](devbox.json); fora dele elas não estão no PATH.

## Inteligência de código (LSP)

O projeto usa o `typescript-language-server` (fixo no `devbox.json`) para ir à definição, achar referências e ver erros de tipo. Prefira isso a buscar texto quando a pergunta for sobre um símbolo.

| Agente       | Como ele chega ao LSP                                                                                                        | O que fazer                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Claude Code  | Plugin oficial `typescript-lsp`, ativado em [`.claude/settings.json`](.claude/settings.json)                                 | Nada: abrir dentro do devbox basta.                                        |
| Codex        | Ponte `mcp-language-server` (fixa no `devbox.json`), servidor MCP `typescript` em [`.codex/config.toml`](.codex/config.toml) | Marcar o projeto como confiável no Codex; sem isso ele ignora o `.codex/`. |
| Outro agente | Servidor MCP por stdio: `mcp-language-server --workspace . --lsp typescript-language-server -- --stdio`                      | Configurar esse comando no agente, rodando da raiz.                        |

No Codex só as ferramentas de leitura estão ligadas (`definition`, `references`, `hover`, `diagnostics`); as edições passam pelo fluxo normal do agente.

Não adicione outro indexador de código (Serena, GitNexus, CodeGraphContext e afins) sem combinar antes: o repositório é pequeno, e cada um traz dependências de terceiros.

## Commits

O e-mail do autor tem que ser o `noreply` do GitHub, `63001165+solracjunio@users.noreply.github.com`; com outro, o GitHub recusa o push. Se o git local estiver com outro e-mail, use `git -c user.email=… commit`.
