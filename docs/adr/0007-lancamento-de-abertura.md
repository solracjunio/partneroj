# 0007. Lançamento de abertura em vez de saldo inicial

- Status: aceito
- Data: 2026-11-05

## Contexto

Uma sociedade pode ter uma conta comum (uma conta bancária ou um caixa em dinheiro) que já tem dinheiro quando o app começa a ser usado. Na obra, o mais provável é não existir conta comum, e cada sócio paga do próprio bolso. Mas o modelo precisa servir também para quem já tem uma.

O acerto depende da **regra de ouro**: a soma dos saldos dos sócios é igual à soma dos saldos das contas da empresa. Ela só fecha se todo real que está numa conta tiver um dono entre os sócios. Um dinheiro "sem dono" numa conta aparece no saldo da conta, mas não no de nenhum sócio, e a regra quebra.

## Opções consideradas

1. **Campo de saldo inicial na conta:**
   - Vantagem: é o jeito que todo banco e toda planilha mostram.
   - Desvantagem: o dinheiro não tem dono. Na hora do acerto, ninguém sabe de qual sócio era o valor que já estava lá, e a regra de ouro deixa de fechar.
2. **Receita de abertura** (o saldo inicial entra como uma receita):
   - Vantagem: o dinheiro entra pelos lançamentos, e a regra de ouro fecha.
   - Desvantagem: a receita é dividida entre os sócios pelas cotas. Se o dinheiro era de um sócio só, ele passa a ser de todos, e o resultado da obra fica inflado por um valor que não é lucro.
3. **Lançamento de abertura** (Sócio → Conta):
   - Vantagem: o dinheiro entra pelos lançamentos e tem dono. Ele conta como contribuição de quem o colocou, como um aporte, e não entra no resultado.
   - Desvantagem: se o dinheiro já na conta é de vários sócios, é preciso um lançamento de abertura para cada um, e alguém precisa saber de quem é cada parte.

## Decisão

**Toda conta começa em zero.** O dinheiro que já estava nela entra por **lançamentos de abertura**, um por sócio, com o valor que é dele.

- A API recusa criar conta com saldo inicial. No domínio, a conta nem tem um campo de saldo: o saldo dela é sempre a soma dos lançamentos.
- A abertura conta como **contribuição** do sócio, como um aporte, e não mexe no resultado.
- A abertura segue as mesmas regras de qualquer lançamento (ADR 0006). Se ela estiver errada, faz-se o estorno, que é recusado se deixaria a conta negativa.
- Ela continua um tipo separado do aporte, mesmo com a mesma conta, para que os relatórios mostrem o que já estava na conta antes do app e o que entrou depois.

## Consequências

- (+) A regra de ouro fecha desde o primeiro dia, porque todo dinheiro de conta tem dono.
- (+) No acerto, cada sócio recebe de volta o que colocou na conta, inclusive o que já estava lá antes do app.
- (+) O saldo da conta nunca é um número digitado: ele é sempre calculado a partir dos lançamentos.
- (−) Abrir uma conta com dinheiro de vários sócios exige que eles combinem de quem é cada parte, antes do primeiro lançamento. O app não pode adivinhar isso.
- (−) A abertura e o aporte fazem a mesma conta no saldo, mas são tipos diferentes. É um tipo a mais para explicar na tela.
