# 0008. Fronteiras entre pacotes verificadas pelo lint

- Status: aceito
- Data: 2026-11-15

## Contexto

O monorepo tem seis partes, com estas dependências:

```
domain    (sem dependências)        contracts   (só zod)
   ↑                                 ↑    ↑    ↑
   db                               web  api  worker
   ↑                                      │    │
   └──────────── api e worker ────────────┴────┘
```

Algumas fronteiras entre elas são garantias, e não só organização:

- **O domínio é puro.** As regras de dinheiro (rateio, saldo, estorno) não leem banco, rede nem relógio. É isso que deixa os testes de propriedade e o teste de mutação rápidos e confiáveis.
- **As consultas ficam no `packages/db`.** O isolamento entre sociedades mora no `WHERE` de cada função do `db`, como em `recordExpense`, que procura o projeto e a categoria **dentro da sociedade de quem lança**. Um controller que montasse a própria consulta poderia esquecer esse `WHERE`, e os testes do caminho feliz continuariam passando.
- **A tela não conhece o banco.** O `web` vai para o navegador. Ele fala com a API pelos `contracts`, e nunca importa o `db`, o driver ou o ORM.
- **Os contratos rodam nos dois lados.** O `contracts` é usado pelo navegador e pelo servidor. Por isso ele só depende do `zod`.

Hoje (15/11/2026) todas essas fronteiras são respeitadas, e não há nenhum ciclo de import nos 172 arquivos. Mas elas só se mantêm por disciplina. O pnpm recusa o import de um pacote que não esteja no `package.json`, mas uma linha nova no `package.json` libera tudo. E nada protege as fronteiras **dentro** de um pacote, como um controller que importa o ORM.

Pelo ADR 0003, a IA escreve a maior parte do código. Uma sugestão que "funciona" e cruza uma fronteira passa nos testes e pode passar na revisão.

## Opções consideradas

1. **Só revisão:**
   - Vantagem: nenhuma ferramenta a mais.
   - Desvantagem: a fronteira depende de alguém lembrar dela em cada PR.
2. **`dependency-cruiser`:**
   - Vantagem: regras "de → para" bem expressivas e um gráfico do grafo.
   - Desvantagem: mais uma ferramenta, com configuração e passo próprios no CI. Ela compensa em grafos grandes, não em seis pacotes.
3. **Regras no ESLint**, que já roda no CI e já barra a complexidade acima de 15:
   - Vantagem: o erro aparece no editor e no mesmo passo do CI, com uma mensagem que explica a garantia.
   - Desvantagem: o `no-restricted-imports` só proíbe nomes. A lista de tabelas proibidas sai do `schema.ts`, para não ficar desatualizada.

## Decisão

**As fronteiras viram regras no `eslint.config.js`.** Cada mensagem diz qual garantia a regra protege.

| Onde | Proibido | Por quê |
|------|----------|---------|
| `packages/domain` | qualquer import que não seja relativo | O domínio é puro |
| `packages/contracts` | qualquer import que não seja relativo ou o `zod` | Roda no navegador e no servidor |
| `apps/web` | `@partneroj/db`, `drizzle-orm`, `pg` e `pg-boss` | A tela só fala com a API |
| `apps/api` e `apps/worker` | `drizzle-orm`, `pg`, e as tabelas exportadas pelo `@partneroj/db` | As consultas, com o `WHERE` da sociedade, ficam no `db` |
| Todo o repositório | ciclos de import (`import-x/no-cycle`) | Um ciclo esconde quem depende de quem |

- **Os testes ficam de fora das regras de domínio, contratos e apps.** Um teste de integração pode montar dados direto nas tabelas, porque ele é quem confere a garantia, e não quem a usa.
- **As tabelas proibidas são lidas do `schema.ts` quando o lint carrega.** Uma tabela nova entra na regra sem ninguém lembrar.
- Cada regra foi conferida quebrando o código à mão: o import proibido foi escrito, o lint falhou com a mensagem, e o import foi apagado.

## Consequências

- (+) O isolamento entre sociedades passa a ter uma segunda proteção, verificada pelo CI: além do `WHERE`, a regra que mantém as consultas no lugar onde o `WHERE` está.
- (+) Um erro de fronteira aparece no editor, antes do commit, com o motivo.
- (+) Os ciclos, hoje zero, não voltam sem que o CI avise.
- (−) Quando um app precisar de algo novo do banco, a função entra no `packages/db`, mesmo que a consulta seja pequena.
- (−) O `no-cycle` segue os imports de cada arquivo e deixa o lint um pouco mais lento.
