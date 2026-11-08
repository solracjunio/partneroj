# Operação

Como colocar o Partneroj no ar e mantê-lo funcionando. O stack de produção fica em `infra/production/` e roda na VPS (`ssh partneroj`).

## O que roda no servidor

| Serviço | O que faz | Usuário do banco |
| --- | --- | --- |
| `postgres` | Postgres 18. Nenhuma porta aberta fora do Docker | — |
| `migrate` | Roda uma vez a cada deploy e termina: migrations, login da aplicação e instalação do pg-boss | `partneroj` (dono das tabelas) |
| `api` | API (NestJS), atrás do Caddy em `/api/` | `partneroj_api` (papel `partneroj_app`) |
| `worker` | Jobs do pg-boss | `partneroj_api` |
| `caddy` | HTTPS automático, o app web em `/` e o protótipo do bloco 0 em `/prototipo/` | — |

A API e o worker nunca usam o dono das tabelas. O papel `partneroj_app` não pode alterar nem apagar lançamentos e auditoria, nem desligar os triggers que protegem essas tabelas (migration `0006`). O superusuário pode, e isso está declarado no plano.

Só o Caddy publica portas. Portas publicadas pelo Docker passam por cima do ufw, por isso nenhum outro serviço publica a sua.

## Primeiro deploy (uma vez)

1. Derrubar o stack do teste guiado, que ocupa as portas 80 e 443. Os dados coletados ficam em `~/prototype-test/data/`:

   ```sh
   ssh partneroj 'cd ~/prototype-test && docker compose down'
   ```

2. Clonar o repositório e criar o `.env` com senhas geradas no próprio servidor, sem que elas passem pelo seu computador:

   ```sh
   ssh partneroj
   git clone https://github.com/solracjunio/partneroj.git ~/partneroj
   cd ~/partneroj/infra/production
   { echo "DOMAIN=partneroj.com.br"
     echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
     echo "APP_DB_PASSWORD=$(openssl rand -hex 32)"; } > .env
   chmod 600 .env
   ```

3. Fazer o deploy, como em qualquer outra vez (a seção abaixo).

**Guardar uma cópia do `.env` fora do servidor**, num gerenciador de senhas. Sem a `POSTGRES_PASSWORD`, um backup restaurado não abre com o mesmo usuário.

## Deploy

Do seu computador, depois do merge na `main`:

```sh
infra/production/deploy.sh
```

O script, na VPS:

1. atualiza `~/partneroj` para `origin/main` (ou para o commit passado como argumento);
2. constrói as imagens no próprio servidor;
3. roda o `migrate` e só sobe a API e o worker se ele terminar sem erro;
4. espera a API responder `/health` e só então termina com sucesso.

Se o `migrate` falhar, os containers antigos continuam no ar e o script termina com erro. Para ver o motivo:

```sh
ssh partneroj 'cd ~/partneroj && docker compose -f infra/production/compose.yml logs migrate'
```

**Voltar a uma versão anterior:** `infra/production/deploy.sh <commit>`. Isso só desfaz o código. Uma migration já aplicada continua no banco, e por isso as mudanças de schema seguem a regra do plano: compatíveis, em duas etapas (expandir e depois contrair).

> **Pendente (backup, neste mesmo bloco):** o plano manda fazer backup imediatamente antes de cada migration. Até o backup existir, não há dados reais no banco.

## Trocar a senha da aplicação

Mudar `APP_DB_PASSWORD` no `.env` do servidor e fazer o deploy de novo. O `migrate` aplica a senha nova ao `partneroj_api` antes de a API subir.

A `POSTGRES_PASSWORD` só é lida quando o volume do banco está vazio. Para trocá-la depois, use `ALTER ROLE partneroj PASSWORD '...'` no `psql` e atualize o `.env`.

## Comandos úteis

```sh
# estado dos serviços
ssh partneroj 'cd ~/partneroj && docker compose -f infra/production/compose.yml ps'
# logs da API em tempo real
ssh partneroj 'cd ~/partneroj && docker compose -f infra/production/compose.yml logs -f api'
# psql como dono das tabelas
ssh -t partneroj 'cd ~/partneroj && docker compose -f infra/production/compose.yml exec postgres psql -U partneroj'
```
