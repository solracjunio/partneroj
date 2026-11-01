# 0001. Idioma do projeto

- Status: aceito
- Data: 2026-11-01

## Contexto

Pensei neste projeto para ajudar sócios a terem transparência em seus negócios. O repositório e os documentos podem ser lidos por qualquer pessoa.

Ele também é o meu projeto de portfólio para vagas de desenvolvedor, no Brasil e remotas internacionais. Recrutadores e entrevistadores leem o README e o código.

As pessoas que vão usar o app inicialmente só falam português.

Como o projeto é open source, o inglês é importante para a colaboração. Precisamos decidir onde usar cada idioma, para que eles não se misturem e dificultem o entendimento de cada parte.

## Opções consideradas

1. **Tudo em inglês:**
   - Vantagem: quem for colaborar com o projeto já usa o idioma padrão, que é o inglês.
   - Desvantagem: os primeiros usuários não conseguiriam usar o app, porque a interface estaria em inglês.
2. **Tudo em português:**
   - Vantagem: fácil acesso e colaboração para brasileiros.
   - Desvantagem: fica difícil para quem não é do Brasil colaborar ou avaliar o projeto, e foge da convenção que a maioria dos projetos segue.
3. **Dividido por parte do projeto:**
   - Vantagem: consigo alcançar tanto colaboradores e recrutadores quanto usuários.
   - Desvantagem: o mesmo conceito passa a ter dois nomes, um no código e outro na tela, e os dois precisam ser mantidos alinhados.

## Decisão

Opção 3, dividido por parte do projeto:

| Parte do projeto | Idioma |
|------------------|--------|
| README | Inglês |
| Código (tipos, funções, variáveis, nomes de arquivos) | Inglês |
| Mensagens de commit | Inglês |
| API (rotas, campos JSON, códigos de erro) | Inglês |
| Textos da interface do app (telas, botões, avisos push) | Português |
| Mensagens de erro mostradas ao usuário | Português |
| ADRs e documentos em `docs/` | Português |

Assim consigo conversar com os dois públicos: quem avalia e colabora lê inglês, e quem usa o app lê português.

## Consequências

- (+) Comunicação clara com cada público.
- (+) O código segue a convenção da maioria dos projetos e das vagas.
- (−) O mesmo conceito tem dois nomes: `Entry` e "lançamento", `Reversal` e "estorno", `Settlement` e "acerto". Para não se perderem, os dois nomes ficam num glossário em `docs/glossario.md`, atualizado sempre que um conceito novo surgir.
- (−) Quem não lê português não consegue ler os ADRs. Aceito esse custo, porque os ADRs registram o meu raciocínio, eu escrevo e explico com mais precisão na minha língua. Se aparecerem colaboradores estrangeiros, um ADR novo pode rever isso.
- (−) Dois idiomas no mesmo repositório exigem atenção na revisão: um texto de tela em inglês, ou um nome de variável em português, é um erro a corrigir.
