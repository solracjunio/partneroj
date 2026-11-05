# 0006. Lançamentos imutáveis, com estorno único e status derivado

- Status: aceito
- Data: 2026-11-05

## Contexto

Os sócios lançam os gastos da obra pelo celular, e lançamentos errados vão acontecer: um valor digitado errado, um gasto duplicado, uma nota do sócio errado. Ao mesmo tempo, o app só é útil se todos confiarem no histórico. Um lançamento que muda sem deixar rastro, ou que some, é exatamente o tipo de coisa que gera desconfiança entre sócios.

O app também precisa mostrar o estado de cada lançamento (confirmado, em votação ou estornado) e somar os gastos por categoria nos relatórios.

## Opções consideradas

### Como corrigir um lançamento

1. **Editar o lançamento** (`UPDATE`) e guardar a versão anterior numa tabela de histórico:
   - Vantagem: o lançamento mostra sempre o valor certo, e a lista fica curta.
   - Desvantagem: o saldo de ontem muda sem que exista um fato novo que explique a mudança. O histórico existe, mas fica fora do caminho principal, e é fácil esquecer de gravá-lo.
2. **Apagar o lançamento** (exclusão lógica, com uma marca de "apagado"):
   - Vantagem: é simples, e o valor errado some dos saldos.
   - Desvantagem: some também o motivo. Toda consulta precisa lembrar de filtrar os apagados.
3. **Estorno:** o lançamento nunca muda. Para corrigir, cria-se um lançamento novo que o cancela e, se preciso, outro com o valor certo:
   - Vantagem: o histórico é a própria fonte dos saldos, e cada mudança é um fato com autor, data e motivo, avisado a todos.
   - Desvantagem: a lista cresce, e a tela precisa mostrar o original e o estorno juntos, para não confundir.

### Como é o estorno

1. **O tipo oposto** (o estorno de uma despesa é uma receita):
   - Vantagem: os valores continuam sempre positivos.
   - Desvantagem: os relatórios inflam. Um gasto de R$ 350 em Material estornado vira "R$ 350 de despesa e R$ 350 de receita", em vez de zero.
2. **O mesmo tipo e a mesma categoria, com o sinal invertido** (uma despesa de −R$ 350 em Material):
   - Vantagem: o estorno se anula dentro da mesma linha do relatório, e a fórmula do saldo funciona sem nenhum caso especial.
   - Desvantagem: os valores podem ser negativos, mas só nos estornos.

### Quantas vezes

1. **Sem limite**, inclusive estorno de estorno:
   - Vantagem: tudo pode ser desfeito.
   - Desvantagem: cadeias de estornos são difíceis de ler, e dois pedidos ao mesmo tempo podem estornar o mesmo lançamento duas vezes, cancelando o dobro do valor.
2. **Uma vez só, e estorno de estorno é proibido:**
   - Vantagem: cada lançamento tem no máximo um estorno, fácil de mostrar e de garantir no banco. Para desfazer um estorno, faz-se um lançamento novo, que é um fato claro.
   - Desvantagem: corrigir duas vezes o mesmo erro gera mais lançamentos.

### Como guardar o status

1. **Uma coluna de status** no lançamento:
   - Vantagem: a leitura é direta.
   - Desvantagem: o status pode discordar dos fatos, por exemplo marcado como "estornado" sem estorno, e passa a exigir um `UPDATE`, o que contraria a imutabilidade.
2. **Status derivado**, calculado na leitura:
   - Vantagem: nunca discorda dos fatos, porque é calculado a partir deles.
   - Desvantagem: toda leitura de status consulta os estornos e as votações abertas.

## Decisão

- **O lançamento nasce confirmado e nunca recebe `UPDATE` nem `DELETE`.** A correção é um estorno e, se preciso, um lançamento novo.
- **O estorno tem o mesmo tipo e a mesma categoria do original, com o sinal invertido**, e aponta para ele (`reversalOf`).
- **Um lançamento só pode ser estornado uma vez, e estorno de estorno é proibido.** O domínio recusa com uma mensagem clara, e um **índice único** na coluna do estorno garante a regra mesmo com dois pedidos simultâneos.
- **O motivo do estorno é obrigatório** e vai junto no aviso para os sócios.
- **O autor pode estornar o próprio lançamento a qualquer momento**, inclusive durante uma votação, que então termina sem efeito. Os outros sócios contestam pela votação (ADR 0004).
- **Nenhum lançamento nem estorno pode deixar uma conta negativa.** O domínio simula os saldos com o lançamento novo e recusa se alguma conta ficar abaixo de zero. Zerar a conta é permitido.
- **O status é derivado:** *estornado* se existe um estorno para o lançamento, *em votação* se há uma votação aberta sobre ele e *confirmado* nos outros casos. O estorno vence a votação.
- As recusas de regra de negócio são um `DomainError` com um código (`already-reversed`, `reversal-of-reversal`, `reason-required`, `entry-not-found` e `account-overdrawn`), que a API traduz numa resposta.

## Consequências

- (+) O saldo de qualquer data pode ser refeito a partir dos lançamentos, e cada mudança tem autor, data, motivo e aviso.
- (+) Os relatórios por categoria somam certo sem nenhum filtro: um estorno anula o original na mesma linha.
- (+) O status nunca fica desatualizado, porque não está gravado em lugar nenhum.
- (−) A lista de lançamentos cresce com os estornos. A tela precisa agrupar o original e o estorno e mostrar o motivo.
- (−) O valor de um lançamento pode ser negativo, mas só quando ele é um estorno. A API recebe valores sempre positivos do usuário, e só o domínio cria valores negativos.
- (−) A checagem de conta negativa olha o saldo final, e não o saldo dia a dia. Um gasto com data de ontem, que só cabe por causa de um aporte de hoje, passa na checagem. Isso basta para a obra, que provavelmente não terá conta comum, e a checagem pelo saldo corrente entra junto com os períodos.

### Como verificar

Testes do domínio (bloco 1A, `reversal.test.ts` e `categories.test.ts`):

- O estorno mantém o tipo e a categoria e inverte o sinal.
- São recusados o estorno sem motivo, o de um lançamento inexistente, o segundo estorno, o estorno de estorno e o estorno que deixaria uma conta negativa.
- O status é confirmado, em votação ou estornado, e o estorno vence a votação.
- Um gasto estornado se anula na própria categoria e não aparece como receita.
- Propriedade: estornar todos os lançamentos devolve todos os saldos a zero.
