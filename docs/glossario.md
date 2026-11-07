# Glossário

O código está em inglês e a interface em português (ver [ADR 0001](adr/0001-idioma-do-projeto.md)). Esta tabela liga os dois nomes de cada conceito.

| Código (inglês) | Interface (português) | Significado |
|-----------------|-----------------------|-------------|
| `Partnership` | Sociedade | O grupo de sócios que administra os projetos |
| `Member` | Membro | Pessoa da sociedade: administrador, sócio ou leitor |
| `Partner` | Sócio | Membro que lança, vota e participa do acerto |
| `Project` | Projeto | Uma obra ou um negócio contínuo |
| `weight` | Cota (peso) | A parte de cada sócio, como peso inteiro (1:1:1 para cotas iguais). Não usar `share` |
| `resultPart` | Rateio (parte do resultado) | A parte do resultado do projeto que cabe ao sócio, em centavos, calculada pelos pesos. Não usar `share` |
| `Account` | Conta | Conta bancária ou caixa da sociedade |
| `Entry` | Lançamento | Um movimento de dinheiro, imutável |
| `Reversal` | Estorno | Lançamento que anula outro, com sinal invertido |
| `Expense` | Despesa | |
| `Income` | Receita | |
| `Contribution` | Aporte / contribuição | Dinheiro ou bem que o sócio coloca |
| `InKindContribution` | Aporte em bens | Material que o sócio já tinha, com valor combinado |
| `Withdrawal` | Retirada | |
| `Reimbursement` | Reembolso | |
| `Transfer` | Transferência | Entre duas contas da sociedade |
| `OpeningEntry` | Lançamento de abertura | Dinheiro que já estava na conta, com dono |
| `Settlement` | Acerto | Quem paga quem no fim |
| `Ballot` | Votação | A votação inteira: contestação de um lançamento ou mudança de membro |
| `Vote` | Voto | O "sim" ou "não" de uma pessoa numa votação |
| `Receipt` | Comprovante | Foto do recibo |
