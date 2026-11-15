# 0009. Simplificação de dívidas: busca exata até 8 participantes, guloso acima

- Status: aceito
- Data: 2026-11-15

## Contexto

No acerto final, cada participante tem um saldo, e a soma de todos é zero. Os participantes são os sócios e as contas, que entram devendo o que guardam. O app sugere quem paga quem. Cada transferência é um Pix ou uma retirada que alguém precisa fazer, então **menos transferências é melhor**: menos trabalho e menos chance de erro.

O algoritmo guloso (o maior devedor paga o maior credor, até zerar todos) é simples e garante no máximo **n − 1** transferências para n participantes com saldo diferente de zero. Mas ele **nem sempre acha o mínimo**. O menor caso tem 5 participantes, e foi encontrado por força bruta (com 3 ou 4, o guloso sempre acerta):

| Participante | Saldo   |
| ------------ | ------- |
| A            | −R$ 900 |
| B            | −R$ 800 |
| C            | +R$ 200 |
| D            | +R$ 700 |
| E            | +R$ 800 |

- **O guloso faz 4:** A paga 800 a E, B paga 700 a D, A paga 100 a C, e B paga 100 a C.
- **O mínimo é 3:** B paga 800 a E, A paga 200 a C, e A paga 700 a D.

O que o guloso não vê é que B e E formam sozinhos um grupo de soma zero. Em geral, **o número mínimo de transferências é n menos o maior número de grupos de soma zero** em que os participantes podem ser divididos. Cada grupo de k pessoas precisa de k − 1 transferências, e nenhuma transferência precisa cruzar grupos. Achar essa divisão é um problema NP-difícil (contém o problema da soma de subconjuntos): não se conhece algoritmo rápido para qualquer n.

## Opções consideradas

1. **Só o guloso:**
   - Vantagem: rápido para qualquer n e fácil de explicar.
   - Desvantagem: às vezes sugere uma transferência a mais, e alguém faz um Pix que não precisava.
2. **Busca exata sempre:**
   - Vantagem: sempre o mínimo.
   - Desvantagem: o tempo cresce exponencialmente. Na ordem de 3^n passos, 8 participantes dão 6.561, mas 20 dão cerca de 3,5 bilhões.
3. **Busca exata até 8 participantes com saldo diferente de zero, e o guloso acima disso:**
   - Vantagem: o mínimo real em todos os casos que o app deve ver (a obra tem 3 sócios e talvez uma conta), sem risco de travar a API num caso grande.
   - Desvantagem: dois algoritmos para testar e explicar.

## Decisão

**Escolhemos a opção 3.**

- **A busca exata** percorre os subconjuntos de quem ainda não está em grupo. Cada grupo de soma zero contém o primeiro participante que sobrou, para não contar a mesma divisão duas vezes. Ela fica com a divisão que tem mais grupos. Com até 8 participantes, o pior caso medido (todas as listas de 8 saldos entre −3 e 3, onde mais aparecem grupos de soma zero) é de 1.245 passos, instantâneo. Por isso a busca não guarda resultados intermediários (memoização): com memória, o limite seria de 3^8 = 6.561 passos, mas o código ficaria maior sem ganho real.
- **Dentro de cada grupo, as transferências saem pelo guloso.** Num grupo que não se divide em grupos menores, o guloso faz exatamente k − 1, que é o mínimo.
- **Acima de 8 participantes com saldo diferente de zero,** o resultado vem só do guloso, com a garantia de n − 1.
- **Quem já está zerado não conta** para o limite nem entra na busca.
- **Os dois são deterministas.** Os mesmos saldos, na mesma ordem, sempre dão as mesmas transferências, porque o acerto é anunciado 7 dias antes e não pode mudar entre o anúncio e a tela.
- **Os testes provam o caso acima** (o guloso faz 4, a busca faz 3) e, por propriedade, que a busca nunca faz mais transferências que o guloso.

## Consequências

- (+) Nos casos reais, o acerto sugere o mínimo de Pix e de retiradas.
- (+) A garantia de n − 1 vale sempre, inclusive acima do limite.
- (+) O exemplo da tabela é uma boa história de entrevista: um algoritmo guloso que parece certo, o contraexemplo achado por força bruta, e a redução do problema a "maior número de grupos de soma zero".
- (−) Acima de 8 participantes, o app pode sugerir transferências a mais. O limite pode subir se aparecer uma sociedade maior: 3^12 ainda é cerca de meio milhão de passos.
- (−) São dois algoritmos no `packages/domain`, com testes para cada um e para a escolha entre eles.
