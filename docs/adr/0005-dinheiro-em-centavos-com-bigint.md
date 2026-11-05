# 0005. Dinheiro em centavos com `bigint`

- Status: aceito
- Data: 2026-11-05

## Contexto

O Partneroj registra todo o dinheiro de uma obra: gastos, aportes, retiradas e o acerto final entre os sócios. Um erro de arredondamento aqui não é cosmético: ele muda quanto cada sócio recebe e quebra a regra de ouro (a soma dos saldos dos sócios é igual à soma dos saldos das contas), que é conferida no centavo.

O valor passa por três lugares, e cada um tem o seu tipo de número:

- **No código** (TypeScript), o `number` é ponto flutuante de 64 bits: `0.1 + 0.2` dá `0.30000000000000004`. Ele só representa inteiros com exatidão até 2⁵³ − 1.
- **No banco** (PostgreSQL), há `numeric`, `integer` (até cerca de R$ 21 milhões em centavos) e `bigint`.
- **No JSON** entre a API e o app, só existe um tipo de número, e `JSON.stringify` lança erro quando encontra um `bigint`.

## Opções consideradas

### No código

1. **`number` em reais** (`350.5`):
   - Vantagem: é o mais direto de escrever e de mostrar.
   - Desvantagem: o ponto flutuante não representa a maioria dos centavos com exatidão. Os erros se acumulam nas somas e aparecem como R$ 0,01 de diferença.
2. **`number` inteiro em centavos** (`35050`):
   - Vantagem: é exato até cerca de R$ 90 trilhões e funciona com os operadores de sempre.
   - Desvantagem: nada impede que um valor decimal entre por acidente, como `35050 / 3`. O erro só aparece quando alguém confere a conta.
3. **`bigint` em centavos** (`35050n`):
   - Vantagem: é exato em qualquer tamanho. A divisão é sempre inteira, e o TypeScript **proíbe misturar** `bigint` com `number` sem conversão explícita, então um decimal não entra por acidente.
   - Desvantagem: exige o sufixo `n` nos literais. `Math` não funciona com `bigint`, e a divisão arredonda em direção ao zero, o que precisa de cuidado com valores negativos (ADR 0002).
4. **Biblioteca de decimais** (decimal.js, dinero.js):
   - Vantagem: é feita para dinheiro, com arredondamentos configuráveis.
   - Desvantagem: é uma dependência a mais no núcleo do domínio, que é puro, e os valores viram objetos. O projeto só precisa de somas e de uma divisão (o rateio), e o maior resto já resolve a divisão.

### No banco

1. **`numeric(14,2)`**: exato, mas o driver do Postgres devolve uma string decimal (`"350.50"`), que precisaria ser convertida para centavos em toda leitura.
2. **`integer`**: o limite de cerca de R$ 21 milhões em centavos é apertado para a soma de uma obra inteira.
3. **`bigint`**: corresponde ao `bigint` do código, sem conversão de escala.

### No JSON

1. **String de centavos** (`"amount": "35050"`):
   - Vantagem: sem perda de precisão em nenhum tamanho. O app faz `BigInt("35050")` e pronto. Fica claro que o valor está em centavos.
   - Desvantagem: o contrato precisa validar o formato (só dígitos, com sinal opcional), e quem lê o JSON à mão vê um texto, não um número.
2. **Número de centavos** (`"amount": 35050`, como a Stripe):
   - Vantagem: é o mais natural no JSON.
   - Desvantagem: o `JSON.parse` o transforma em `number`. Acima de 2⁵³ − 1 ele perde precisão sem avisar, então a API teria de validar o limite em toda entrada.
3. **String decimal em reais** (`"amount": "350.50"`):
   - Vantagem: é legível para humanos.
   - Desvantagem: exige regras de parse nos dois lados (`"350.5"`, `"350,50"`) e traz de volta o risco de erro de casas decimais.

## Decisão

**Todo valor de dinheiro é um inteiro em centavos, do banco ao app:**

- **No código: `bigint`.** O pacote `packages/domain` recebe e devolve `bigint` em todas as funções de dinheiro.
- **No banco: coluna `bigint`.**
- **No JSON: string de centavos**, com sinal opcional. O contrato (`packages/contracts`) valida o formato `^-?\d+$` e converte para `bigint` na borda da API. A resposta faz o caminho inverso.
- **Na tela:** a conversão para "R$ 350,50" acontece só no app, na hora de mostrar, com `Intl.NumberFormat("pt-BR")`. A digitação do usuário é convertida para centavos uma vez, quando o formulário é enviado.

## Consequências

- (+) Nenhum valor perde precisão em nenhuma das três camadas, e a regra de ouro pode ser conferida com igualdade exata.
- (+) O compilador recusa misturar dinheiro com `number`, o que pega o erro mais comum antes de rodar.
- (+) A unidade é uma só (centavos) em todo o caminho. Só a tela fala em reais.
- (−) Toda divisão é inteira, então o rateio precisa decidir para onde vai cada centavo. O ADR 0002 resolve isso com o maior resto, e trata o arredondamento em direção ao zero dos valores negativos.
- (−) O JSON não serializa `bigint` sozinho. A API precisa de uma conversão explícita na borda, e um esquecimento vira erro em tempo de execução, não de compilação. Um teste do contrato cobre isso.
- (−) Quem lê o JSON à mão vê `"35050"`, e não `350.50`.
