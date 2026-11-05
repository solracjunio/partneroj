# 0004. Votação sobre lançamento por unanimidade

- Status: aceito
- Data: 2026-11-05

## Contexto

No Partneroj, quem discorda de um lançamento de outro sócio abre uma votação. A proposta é **arquivar** o lançamento (ele é estornado) ou **corrigi-lo** (ele é estornado e um novo é criado com os valores propostos). Todos os sócios votam, inclusive quem abriu a votação e o autor do lançamento. Quem não vota conta como "não", e o prazo é de 7 dias.

Na maioria dos casos, a proposta **tira dinheiro do autor**. Arquivar uma despesa dele, ou diminuir o valor dela, reduz o quanto ele "já colocou" na obra. O plano deixou essa regra para os sócios decidirem no bloco 0.

A obra tem 3 sócios, com cotas iguais. O app vai registrar todo o dinheiro da obra ao longo de 2027. Mais do que decidir rápido, o que importa é que **ninguém se sinta passado para trás** por uma maioria.

A escolha foi feita com o protótipo clicável (`prototype/`). A tela de votações mostrava o mesmo caso, de 2 votos contra 1, nas duas regras.

## Opções consideradas

1. **Maioria absoluta** (2 de 3):
   - Vantagem: decide mesmo quando alguém discorda. Uma correção justa não fica travada.
   - Desvantagem: dois sócios podem mudar o gasto do terceiro contra a vontade dele.
2. **Maioria e o "sim" do autor** (2 de 3, com o autor entre eles):
   - Vantagem: ninguém tem o próprio gasto mudado sem concordar.
   - Desvantagem: um sócio de fora não consegue barrar uma correção com a qual o autor e quem abriu a votação concordam.
3. **Unanimidade** (os 3 concordam, inclusive o autor):
   - Vantagem: nenhuma mudança acontece sem o acordo de todos. Cada correção aprovada é um consenso registrado.
   - Desvantagem: qualquer "não", ou qualquer pessoa que não vote, mantém o lançamento como está.

## Decisão

**Escolhemos a opção 3, a unanimidade,** para toda votação sobre um lançamento.

- A proposta só é aprovada com o "sim" de **todo o eleitorado congelado na abertura**: o autor, quem abriu a votação e os demais sócios.
- Quem não vota até o prazo conta como "não". Com a unanimidade, isso basta para rejeitar a proposta.
- A votação **termina no primeiro "não"**, porque o resultado não pode mais mudar. Essa regra já existia no plano ("termina antes do prazo assim que o resultado não puder mais mudar"), e com a unanimidade ela passa a valer no primeiro voto contra.
- A regra vira uma **configuração da sociedade** (`maioria` ou `unanimidade`), como o plano previa. A obra usa `unanimidade`. Sociedades novas começam com `maioria`, que é o padrão do plano.
- **As votações sobre membros** (entrada, promoção e remoção de sócio) continuam por maioria absoluta. Elas não mudam o lançamento de ninguém, e a unanimidade permitiria que um sócio impedisse a própria remoção.

## Consequências

- (+) Nenhum sócio tem o próprio gasto mudado sem concordar. A votação vira um pedido formal de correção, com motivo e registro, e todos ficam avisados.
- (+) A apuração fica mais simples: basta um "não" para encerrar. É mais fácil de testar no `packages/domain`.
- (−) Um lançamento errado pode continuar valendo se o autor não concordar com a correção. A discordância fica registrada na votação rejeitada e pode ser retomada na conversa do acerto final.
- (−) Um sócio que não abre o app por 7 dias derruba qualquer correção. O lembrete de 24 h antes do fim passa a ser mais importante.
- (−) O domínio precisa conhecer as duas regras. Os testes de apuração cobrem os dois modos.
