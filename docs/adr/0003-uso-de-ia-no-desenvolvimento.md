# 0003. Uso de IA no desenvolvimento

- Status: aceito
- Data: 2026-11-02

## Contexto

O Partneroj é o meu projeto de portfólio para uma vaga de desenvolvedor TypeScript full-stack. Tenho anos de experiência com C# e Unity, mas TypeScript, NestJS e React são novos para mim. Numa entrevista, vou precisar explicar e defender o código do repositório, inclusive escrevendo código parecido ao vivo, sem ajuda.

Tenho 12 horas por semana para o projeto, e o plano soma cerca de 226 horas. Os sócios começam a usar o app em 10 de janeiro de 2027, com dinheiro de verdade. Uso uma IA de programação (Claude Code), que consegue escrever boa parte do código e pode encurtar esse prazo.

Isso cria uma tensão:

- se a IA escrever tudo, o projeto anda mais rápido, mas eu posso acabar com um repositório que não sei defender e um TypeScript que não aprendi;
- se eu escrever tudo à mão, aprendo mais, mas não termino a tempo para os sócios.

Este ADR define onde a IA pode escrever código, como esse código é revisado e como confiro que estou aprendendo.

## Opções consideradas

### Que partes eu escrevo à mão

1. **Nenhuma:** a IA pode escrever qualquer parte, e eu leio e reviso tudo.
   - Vantagem: velocidade máxima, o que importa com 12 horas por semana e os sócios começando em janeiro.
   - Desvantagem: o aprendizado depende de eu ler e entender de fato, e não de escrever. Numa entrevista, preciso explicar um código que não digitei.
2. **O núcleo:** eu escrevo à mão o `packages/domain` (rateio, acerto, simplificação de dívidas e apuração de votação), e a IA escreve o resto.
   - Vantagem: o código que um entrevistador mais deve pedir para explicar é justamente o que escrevi.
   - Desvantagem: o bloco do domínio fica mais lento, numa fase em que o prazo de janeiro já está apertado.
3. **Tudo:** eu escrevo todo o código, e a IA só explica e revisa.
   - Vantagem: o máximo de aprendizado.
   - Desvantagem: as cerca de 226 horas do plano crescem muito, e a data dos sócios fica comprometida.

### Como o código da IA é revisado

1. **No fim de cada bloco**, lendo tudo de uma vez:
   - Vantagem: menos interrupções.
   - Desvantagem: são milhares de linhas de uma vez, e a leitura vira uma olhada por cima. Um erro do começo do bloco já está espalhado pelo resto.
2. **A cada commit, direto no `main`:** commits pequenos, com um assunto por vez. A IA explica, eu leio o diff e só então autorizo o commit.
   - Vantagem: cada diff cabe numa leitura curta, e as dúvidas aparecem enquanto o assunto está fresco.
   - Desvantagem: o `main` não fica protegido, e as dúvidas ficam só no chat, que se perde.
3. **Por pull request no GitHub:** cada funcionalidade num branch, com vários commits pequenos, a CI rodando e comentários meus nas linhas do diff. O código só entra no `main` depois do merge.
   - Vantagem: o `main` só recebe o que eu li e o que passou nos testes. As dúvidas ficam registradas junto da linha. O histórico de revisão aparece no portfólio.
   - Desvantagem: mais passos por mudança. Exige o repositório no GitHub e a CI configurada.

### Como confiro que estou aprendendo

1. **Nada formal:** confio na leitura e nas dúvidas que surgirem.
   - Vantagem: nenhum custo.
   - Desvantagem: a ilusão de entendimento (achar que entendeu porque a explicação estava ao lado) só aparece na entrevista.
2. **Teste de reescrita:** no fim de cada bloco, reescrevo sem ajuda, em 30 minutos, uma função importante daquele bloco, e rodo os testes originais contra a minha versão.
   - Vantagem: é o mais parecido com um teste técnico ao vivo.
   - Desvantagem: cerca de 30 minutos por bloco, e escolher a função certa exige critério.
3. **Quiz:** no fim de cada bloco, a IA faz perguntas sobre o código e as decisões daquele bloco.
   - Vantagem: é rápido (10 a 15 minutos) e cobre o porquê das escolhas, que é o que mais aparece em entrevista.
   - Desvantagem: saber explicar não é o mesmo que saber escrever.
4. **Quiz e teste de reescrita juntos:**
   - Vantagem: cobre o porquê e o como.
   - Desvantagem: cerca de 45 minutos por bloco.

## Decisão

### A IA pode escrever qualquer parte do código

Escolhi a opção 1, com três condições:

- **A IA explica o código que escreve:** o que ele faz e por que foi escrito daquele jeito, incluindo as alternativas descartadas.
- **A IA explica as decisões** antes de tomá-las. As decisões importantes viram ADRs, escritos em conversa, como este.
- **Eu leio tudo o que entra no repositório.** Quando encontro um erro ou fico com dúvida, paro e pergunto antes de seguir.

Assim mantenho a velocidade que o prazo dos sócios exige, e o aprendizado vem de ler, perguntar e revisar, em vez de digitar.

### Revisão a cada commit agora, por pull request depois

**Até o repositório estar no GitHub com a CI:** revisão a cada commit, direto no `main`. Cada commit trata de um assunto só. A IA explica o que mudou, eu leio o diff, e o commit só acontece quando eu autorizo.

**Depois:** revisão por pull request. Cada funcionalidade é feita num branch, em commits pequenos, e vira um PR com descrição. Eu leio o diff no GitHub e comento nas linhas em que tiver dúvida, e a IA responde com novos commits no mesmo branch. Só faço o merge com a CI verde, e o `main` fica protegido contra push direto.

Nos dois casos, o commit continua sendo a unidade de leitura: pequeno o bastante para ser lido de verdade.

### Quiz no fim de cada bloco

No fim de cada bloco, a IA faz um quiz de 5 perguntas sobre o código e as decisões daquele bloco: o que cada parte faz, por que foi feita assim e o que aconteceria em casos diferentes.

**Preciso acertar pelo menos 3 das 5.** Se acertar menos, o bloco seguinte passa para o modo Learning: a IA deixa partes do código para eu escrever. Volto ao modo normal quando for bem no quiz seguinte.

## Consequências

- (+) O prazo de janeiro fica viável, e o bloco do domínio passa a contar na medição do ganho da IA.
- (+) O raciocínio fica registrado: as explicações acompanham cada commit, e as decisões importantes viram ADRs.
- (+) Os commits feitos com a IA levam a linha `Co-Authored-By`, então o histórico mostra com transparência o que foi feito com ajuda.
- (−) Não escrevo o código, e o quiz não testa se sei escrevê-lo. Aceito o risco de travar num teste técnico ao vivo. Se isso aparecer num quiz ou numa entrevista, um ADR novo pode trazer de volta o teste de reescrita.
- (−) A regra depende de disciplina: se eu autorizar um commit sem ler, nada avisa. Commits pequenos reduzem essa tentação.
- (−) O plano v4 previa o domínio escrito à mão e o teste de reescrita. Este ADR substitui essas duas regras.
