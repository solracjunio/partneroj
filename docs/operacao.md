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
| `backup` | Não fica no ar. Os timers do systemd e o `deploy.sh` o chamam para fazer backup ou testar a restauração | `partneroj` |

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
     echo "APP_DB_PASSWORD=$(openssl rand -hex 32)"
     echo "RESTIC_PASSWORD=$(openssl rand -hex 32)"
     echo "BACKUP_DIR=/srv/partneroj-backup"; } > .env
   chmod 600 .env
   ```

3. Preparar o backup (a seção [Backup](#backup)).

4. Fazer o deploy, como em qualquer outra vez (a seção abaixo).

**Guardar uma cópia do `.env` fora do servidor**, num gerenciador de senhas. Sem a `RESTIC_PASSWORD`, nenhum backup pode ser lido, nunca. Sem a `POSTGRES_PASSWORD`, fica mais difícil entrar como dono num servidor restaurado.

## Deploy

Do seu computador, depois do merge na `main`:

```sh
infra/production/deploy.sh
```

O script, na VPS:

1. atualiza `~/partneroj` para `origin/main` (ou para o commit passado como argumento);
2. constrói as imagens no próprio servidor, com os containers antigos ainda no ar;
3. faz um **backup marcado `pre-deploy`**, imediatamente antes das migrations. Se o backup falhar, o deploy para aqui;
4. roda o `migrate` e só sobe a API e o worker se ele terminar sem erro;
5. espera a API responder `/health` e só então termina com sucesso.

Se o `migrate` falhar, os containers antigos continuam no ar e o script termina com erro. Para ver o motivo:

```sh
ssh partneroj 'cd ~/partneroj && docker compose -f infra/production/compose.yml logs migrate'
```

**Voltar a uma versão anterior:** `infra/production/deploy.sh <commit>`. Isso só desfaz o código. Uma migration já aplicada continua no banco, e por isso as mudanças de schema seguem a regra do plano: compatíveis, em duas etapas (expandir e depois contrair). Se uma migration estragou dados, restaure o backup `pre-deploy` daquele deploy (a seção [Restaurar de verdade](#restaurar-de-verdade)).

## Backup

Um repositório **restic** criptografado em `/srv/partneroj-backup`, no disco da VPS, fora de qualquer volume do Docker. Um `docker compose down -v` apaga os volumes, e não pode levar o backup junto com o banco.

Cada snapshot guarda:

- `partneroj.dump`: o banco inteiro (`pg_dump`, formato custom);
- `roles.sql`: os papéis do cluster, sem as senhas. O `pg_dump` não os inclui, e o banco depende de `partneroj_app`.

| Quando | O quê | Como |
| --- | --- | --- |
| Toda noite, 03:30 (Brasília) | Backup `daily` | `partneroj-backup.timer` |
| Antes de cada migration | Backup `pre-deploy` | `deploy.sh` |
| Dia 1 de cada mês, 05:00 | Teste de restauração | `partneroj-restore-check.timer` |

**Retenção** (plano, seção 11): 7 diários, 4 semanais e 12 mensais.

> **Ainda falta (neste bloco):** a cópia para o PC de casa (WireGuard e rest-server), o backup dos arquivos de comprovantes (quando o upload existir) e o alerta do Uptime Kuma quando um timer falhar. Até lá, confira os timers com `systemctl list-timers 'partneroj-*'` e as falhas com `systemctl --failed`.

### Preparar (uma vez)

```sh
ssh partneroj
# a pasta do repositório, do usuário postgres (uid 70) da imagem de backup
sudo install -d -o 70 -g 70 -m 700 /srv/partneroj-backup
# os timers
sudo cp ~/partneroj/infra/production/systemd/partneroj-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now partneroj-backup.timer partneroj-restore-check.timer
```

O primeiro backup cria o repositório. Para fazer um na hora:

```sh
cd ~/partneroj && docker compose -f infra/production/compose.yml run --rm backup
```

**A senha do restic** (`RESTIC_PASSWORD` no `.env`) fica no gerenciador de senhas e **num papel lacrado com outro sócio**. Não há como recuperá-la: sem ela, os backups são ilegíveis.

### Testar a restauração

O teste restaura o snapshot num Postgres novo e vazio, que só existe dentro do container e some no fim. Produção é só lida. O teste confere:

- se o restore termina sem erro e todas as tabelas podem ser lidas;
- se `entries` e `audit_log`, que só recebem inserções e têm ids em ordem de tempo (uuidv7), são **idênticos** em produção até o último id do backup. Uma linha alterada ou apagada depois do backup muda o hash;
- **a regra de ouro**, assim que o relatório de saldos existir (bloco 4).

```sh
cd ~/partneroj
# o mais recente
docker compose -f infra/production/compose.yml run --rm backup restore-check.sh
# um snapshot específico
docker compose -f infra/production/compose.yml run --rm backup restic snapshots
docker compose -f infra/production/compose.yml run --rm backup restore-check.sh <id>
```

O resultado termina em `restore check passed` ou `restore check FAILED`. Para **investigar uma suspeita de alteração**, teste um snapshot *anterior* à suspeita. O mais recente já contém o estado atual, alterado ou não.

### Restaurar de verdade

Só em caso de perda: servidor novo, banco corrompido ou migration que estragou dados.

1. **Fazer um backup do estado atual**, mesmo estragado: `docker compose ... run --rm backup backup.sh before-restore`.
2. Parar a API e o worker: `docker compose -f infra/production/compose.yml stop api worker caddy`.
3. Apagar o banco, criá-lo vazio e restaurar o snapshot, como dono. Não use `pg_restore --clean`: ele falha nas tabelas particionadas do pg-boss.

   ```sh
   docker compose -f infra/production/compose.yml run --rm backup bash -c 'set -e
     restic dump <id> /tmp/backup/partneroj.dump > /tmp/partneroj.dump
     psql -d postgres -v ON_ERROR_STOP=1 \
       -c "DROP DATABASE partneroj WITH (FORCE)" \
       -c "CREATE DATABASE partneroj OWNER partneroj"
     pg_restore --dbname=partneroj --exit-on-error /tmp/partneroj.dump'
   ```

   Num **servidor novo**, aplique antes os papéis, que o `pg_dump` não leva:

   ```sh
   docker compose -f infra/production/compose.yml run --rm backup bash -c \
     "restic dump <id> /tmp/backup/roles.sql | grep -v '^CREATE ROLE partneroj;\$' | psql -d postgres -v ON_ERROR_STOP=1"
   ```
4. Fazer o deploy de novo (`deploy.sh`). O `migrate` aplica a senha do `partneroj_api`, que o backup não guarda.
5. Conferir o app e, quando existir, a regra de ouro.

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
