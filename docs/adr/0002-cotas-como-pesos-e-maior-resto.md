# 0002. Cotas como pesos e rateio pelo maior resto

- Status: aceito
- Data: 2026-11-01

## Contexto

No fim do projeto, o resultado (o que entrou menos o que saiu) é dividido entre os sócios de acordo com a cota de cada um. O dinheiro é guardado em centavos inteiros, e nem toda divisão é exata: R$ 100,00 entre 3 sócios dá R$ 33,333..., e não existe um terço de centavo. Alguém precisa ficar com o centavo que sobra.

Na obra da família são 3 sócios com cotas iguais, e o acerto final só acontece no fim da obra. Um erro pequeno na forma de guardar a cota, aplicado sobre o total gasto, vira uma diferença em reais entre sócios que combinaram partes iguais.

Duas coisas não podem acontecer:

- a soma das partes ser diferente do valor dividido, porque isso quebra a regra de ouro (a soma dos saldos dos sócios é igual à soma dos saldos das contas);
- sócios com a mesma cota receberem valores diferentes, a não ser pelo centavo que não tem como dividir.

## Opções consideradas

Os exemplos usam uma obra ilustrativa com R$ 120.000 de gastos, dividida entre 3 sócios com cotas iguais.

### Como guardar a cota

1. **Porcentagem com casas decimais** (33,33% para cada um):
   - Vantagem: é a forma que todo mundo entende.
   - Desvantagem: 3 × 33,33% = 99,99%, e somem R$ 12. Para fechar 100%, alguém fica com 33,34%. Também puxa para o ponto flutuante, que o projeto proíbe para dinheiro.
2. **Pontos-base**, inteiros que somam 10.000 (3334, 3333 e 3333):
   - Vantagem: a soma fecha e tudo é inteiro.
   - Desvantagem: não representa 1/3. Um sócio paga R$ 40.008 e os outros R$ 39.996. A diferença de R$ 12 está na própria cota e cresce junto com a obra.
3. **Pesos inteiros** (1:1:1 para cotas iguais, 3:2 para 60% e 40%):
   - Vantagem: a parte de cada um é a fração exata `peso / soma dos pesos`. Cotas iguais são iguais de fato: cada um paga R$ 40.000,00.
   - Desvantagem: "peso 3:2" é menos intuitivo que "60%". A tela mostra a porcentagem calculada, só como informação. Pesos diferentes podem significar a mesma divisão (1:1:1 e 2:2:2).

### Como arredondar

Exemplo: 2 sócios, A com 60% (peso 3) e B com 40% (peso 2), dividindo 1 centavo. A parte exata de A é 0,6 centavo, e a de B é 0,4.

1. **Cada um arredonda a própria parte** para o mais próximo:
   - Vantagem: é o mais simples de programar.
   - Desvantagem: a soma nem sempre fecha. R$ 0,02 entre 3 sócios dá 0,67 centavo para cada um, que arredondado vira 1, e a soma é R$ 0,03. Isso quebra a regra de ouro.
2. **Todos arredondam para baixo, e a sobra vai sempre para o mesmo sócio:**
   - Vantagem: a soma sempre fecha.
   - Desvantagem: com cotas diferentes, o centavo pode ir para quem está mais longe dele. Se o sócio fixo for B, ele fica com o centavo mesmo tendo a menor cota.
3. **Maior resto:** todos arredondam para baixo, e os centavos que sobram vão, um para cada, a quem tem o maior resto depois da vírgula:
   - Vantagem: a soma sempre fecha, e ninguém fica mais de 1 centavo longe da parte exata. No exemplo, o centavo vai para A (resto 0,6 contra 0,4).
   - Desvantagem: um pouco mais de código, porque os restos precisam ser ordenados. Com cotas iguais, todos os restos empatam, e é preciso um critério de desempate.

### Quando fazer o rateio

Exemplo: 1.000 gastos de R$ 100,00 divididos entre 3 sócios com cotas iguais.

1. **Dividir cada lançamento** na hora em que ele é feito:
   - Vantagem: a parte de cada sócio em cada gasto fica visível e gravada.
   - Desvantagem: sobra 1 centavo em cada gasto. Se o desempate escolher sempre a mesma pessoa, ela paga R$ 10,00 a mais no fim. Corrigir um lançamento também exige recalcular as partes gravadas.
2. **Dividir uma vez só, sobre o resultado total**, sempre que o saldo ou o acerto é consultado:
   - Vantagem: a diferença máxima é de 1 centavo na obra inteira, não importa quantos lançamentos existam. Um estorno muda o total, e o rateio se ajusta sozinho.
   - Desvantagem: o saldo é sempre calculado, e não lido de um campo gravado. Em negócios contínuos com muitos anos de dados, o fechamento de período limita esse custo.

### Quem fica com o centavo quando os restos empatam

Com cotas iguais, todos os restos são iguais, e o maior resto não decide sozinho. O critério precisa dar sempre o mesmo resultado: um saldo que muda entre duas consultas não merece confiança.

1. **Ordem fixa**, por exemplo quem entrou primeiro na sociedade:
   - Vantagem: é o mais simples, e não há nada a guardar.
   - Desvantagem: quem cadastra os sócios decide, sem querer, quem fica com o centavo.
2. **Ordem sorteada uma vez**, na criação do projeto, e guardada nele:
   - Vantagem: é neutra, porque ninguém escolhe, e não muda depois.
   - Desvantagem: um campo a mais no projeto.
3. **Rodízio**, cada vez um sócio:
   - Vantagem: equilibra o centavo quando há muitos rateios.
   - Desvantagem: como o rateio é feito uma vez só, sobre o total, não há rateios para fazer o rodízio. O resultado passaria a depender do momento da consulta.

### A cota pode mudar durante o projeto?

1. **Cota fixa durante o projeto:** os pesos são definidos na criação do projeto e não mudam.
   - Vantagem: uma fórmula, um rateio e no máximo um centavo de diferença. É simples de testar e de explicar.
   - Desvantagem: para mudar a divisão no meio do caminho, é preciso encerrar o projeto, fazer o acerto e abrir outro.
2. **Cota muda por votação**, valendo a partir de uma data:
   - Vantagem: acompanha uma sociedade que muda com o tempo.
   - Desvantagem: o resultado passa a ser dividido por períodos, cada um com seu rateio e seu centavo de empate. Também é preciso decidir em qual período entra cada lançamento, inclusive o estorno feito depois da mudança de um lançamento anterior a ela.

## Decisão

### Como guardar a cota: pesos inteiros

Cada sócio tem um peso inteiro, maior ou igual a 1. A parte dele é `peso / soma dos pesos`, calculada só com inteiros. É a única opção em que cotas iguais não carregam erro nenhum: o arredondamento acontece só no último centavo, e não na cota.

### Como arredondar: maior resto

Cada sócio recebe a parte inteira de `valor × peso / soma dos pesos`, em centavos. Os centavos que sobram (no máximo um a menos que o número de sócios) vão, um para cada, aos sócios com os maiores restos. É a única das três opções que sempre fecha a soma e continua justa quando as cotas são diferentes.

### Quando fazer o rateio: uma vez só, sobre o total

O rateio não é gravado nos lançamentos. Ele é aplicado sobre o resultado acumulado do projeto sempre que um saldo ou o acerto é consultado:

`Saldo(sócio) = Contribuições(sócio) − Retiradas(sócio) + Rateio(Resultado, pesos)(sócio)`

Assim, o centavo do empate aparece uma vez só, e não uma vez por lançamento. Isso segue a mesma linha do resto do projeto: o lançamento é imutável, e o que pode ser calculado a partir dele (status, saldo, rateio) não é gravado.

### Desempate: ordem sorteada uma vez

Quando o projeto é criado, o sistema sorteia uma ordem entre os sócios e a guarda no próprio projeto. Quando os restos empatam, os centavos que sobram vão para os sócios nessa ordem. A ordem não muda durante o projeto e fica visível para todos.

O valor em jogo é desprezível, no máximo 1 centavo por sócio na obra inteira, mas a regra precisa ser neutra e conhecida antes de existir qualquer desacordo.

**Resultado negativo:** quando o resultado é um prejuízo (a obra só tem gastos), o rateio é feito sobre o valor sem sinal, e o sinal é recolocado no fim. Assim, o sócio sorteado fica com o centavo a mais nos ganhos e paga o centavo a mais nas perdas. Isso também evita misturar dois jeitos de arredondar números negativos (para baixo e em direção ao zero), o que faria a soma não fechar.

### Cota fixa durante o projeto

Os pesos são definidos quando o projeto é criado e não mudam até o fim. Quem entra na sociedade depois participa dos projetos seguintes. Nenhum caso real precisa hoje da cota variável, e ela traria de volta os vários rateios que a decisão anterior evitou. Se um caso real aparecer, um ADR novo substitui este.

### Exemplos

Nos exemplos, o sócio A é o primeiro na ordem sorteada.

| Valor | Pesos | Sócio A | Sócio B | Sócio C |
|-------|-------|---------|---------|---------|
| R$ 100,00 | 1:1:1 | R$ 33,34 | R$ 33,33 | R$ 33,33 |
| −R$ 100,00 | 1:1:1 | −R$ 33,34 | −R$ 33,33 | −R$ 33,33 |
| R$ 0,02 | 1:1:1 | R$ 0,01 | R$ 0,01 | R$ 0,00 |
| R$ 0,01 | 3:2 | R$ 0,01 | R$ 0,00 | (não existe) |
| R$ 120.000,00 | 1:1:1 | R$ 40.000,00 | R$ 40.000,00 | R$ 40.000,00 |

## Consequências

- (+) Sócios com a mesma cota nunca diferem em mais de 1 centavo, qualquer que seja o tamanho da obra.
- (+) A soma das partes é sempre exatamente o valor dividido, e a regra de ouro fecha no centavo.
- (+) O saldo é calculado a partir dos lançamentos. Um estorno muda o resultado, e o rateio se ajusta sem nenhuma correção gravada.
- (−) A tela precisa converter os pesos em porcentagem para mostrar ao usuário. Pesos diferentes podem representar a mesma divisão (1:1:1 e 2:2:2), e isso não muda o resultado.
- (−) O saldo é calculado em toda consulta. Em negócios contínuos com muitos anos de dados, o fechamento de período limita esse custo.
- (−) O projeto guarda a ordem sorteada, que precisa vir de um gerador aleatório seguro e ficar visível para todos os sócios.
- (−) Mudar a cota exige encerrar o projeto e abrir outro. A votação de entrada de sócio vale para a sociedade, e não para um projeto em andamento.

### Como verificar

Testes do domínio (bloco 1A):

- **Propriedade:** para qualquer valor e quaisquer pesos, a soma das partes é exatamente o valor.
- **Propriedade:** sócios com o mesmo peso nunca diferem em mais de 1 centavo.
- **Propriedade:** nenhuma parte fica a 1 centavo ou mais da parte exata.
- **Exemplos:** cada linha da tabela acima.
