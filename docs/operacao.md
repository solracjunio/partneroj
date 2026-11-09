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
| `uptime-kuma` | Monitoramento e alertas no celular, pelo ntfy. O painel só abre por túnel SSH | — |
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
| Todo domingo, 05:00 | Teste de restauração | `partneroj-restore-check.timer` |
| De hora em hora, no minuto 15 | Cópia para o PC de casa, se ele estiver ligado | `partneroj-offsite-copy.timer` |

**Retenção** (plano, seção 11): 7 diários, 4 semanais e 12 mensais. Além disso, **todos** os snapshots dos últimos 7 dias são guardados, para que o backup `pre-deploy` de um dia com dois deploys não seja apagado pelo segundo.

O teste de restauração roda toda semana, mais que o mensal do plano. O Uptime Kuma não aceita um intervalo de heartbeat maior que cerca de 24 dias, e um teste mensal daria alarme falso todo mês.

> **Ainda falta:** o backup dos arquivos de comprovantes, quando o upload existir.

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

### Cópia fora do servidor (PC de casa)

Uma segunda cópia do repositório restic, no PC de casa, para que o backup sobreviva à perda da VPS. O PC fica atrás de CGNAT, então é **ele** que abre um túnel **WireGuard** até a VPS. Quando o PC está ligado, a VPS copia por esse túnel os snapshots novos (`restic copy`) para um **rest-server** no PC.

```
VPS 10.77.0.1  ◄══ túnel WireGuard (o PC abre, keepalive de 25 s) ══  PC 10.77.0.2
  restic copy  ── HTTP :8000, usuário e senha ──►  rest-server --append-only, G:\partneroj-backup
```

**Proteções:**

- **`--append-only`:** o rest-server aceita snapshots novos e recusa apagar ou sobrescrever (403). Mesmo com a VPS invadida, a senha do restic e a do rest-server em mãos, ninguém consegue destruir a cópia de casa pela rede. Isso foi testado: um `restic forget --prune` vindo da VPS foi recusado.
- **O firewall do Windows** só aceita a porta 8000 vinda de `10.77.0.1` pela placa do túnel `partneroj`. A senha do rest-server fica na VPS (`OFFSITE_PASSWORD` no `.env`), e o PC guarda só o hash bcrypt.
- **A pasta `G:\partneroj-backup`** só pode ser acessada por SYSTEM e Administradores. Um programa rodando com a sua conta não consegue ler nem alterar os backups.
- **A mesma senha do restic** dos backups da VPS abre esta cópia. O envelope lacrado vale para as duas.

#### Preparar a VPS (uma vez)

```sh
sudo apt-get install -y wireguard-tools
# chave privada gerada no servidor, só ele a vê
priv=$(wg genkey)
printf '[Interface]\nAddress = 10.77.0.1/24\nListenPort = 51820\nPrivateKey = %s\n' "$priv" \
  | sudo tee /etc/wireguard/wg0.conf >/dev/null
sudo chmod 600 /etc/wireguard/wg0.conf
sudo systemctl enable --now wg-quick@wg0
sudo ufw allow 51820/udp comment "WireGuard backup tunnel"
sudo wg show wg0 public-key   # vai no túnel do PC
# a senha do rest-server, no .env, e o hash dela para o PC
echo "OFFSITE_PASSWORD=$(openssl rand -hex 32)" >> ~/partneroj/infra/production/.env
docker run --rm httpd:2.4-alpine htpasswd -nbB -C 12 partneroj "<OFFSITE_PASSWORD>"
```

#### Preparar o PC (uma vez)

1. Instalar o WireGuard: `winget install --id WireGuard.WireGuard -e`.
2. No app: **Adicionar túnel → Adicionar túnel vazio**, com o nome `partneroj`. O app gera a chave privada. Complete com:

   ```ini
   [Interface]
   PrivateKey = (gerada pelo app)
   Address = 10.77.0.2/32

   [Peer]
   PublicKey = <chave pública da VPS>
   AllowedIPs = 10.77.0.1/32
   Endpoint = 187.41.120.97:51820
   PersistentKeepalive = 25
   ```

   O endpoint vai pelo IP porque o domínio também tem registro IPv6, e numa rede só IPv4 o túnel não subiria.
3. Na VPS, acrescentar o PC como peer, com a chave **pública** dele:

   ```sh
   printf '\n[Peer]\nPublicKey = <chave pública do PC>\nAllowedIPs = 10.77.0.2/32\n' | sudo tee -a /etc/wireguard/wg0.conf
   sudo wg set wg0 peer '<chave pública do PC>' allowed-ips 10.77.0.2/32
   ```

4. **Ativar** o túnel no app. Ele fica como serviço automático do Windows e sobe no boot.
5. Num PowerShell **como administrador**, rodar `infra/home-pc/setup-rest-server.ps1` com o hash. Use **aspas simples**, porque o hash tem `$`:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup-rest-server.ps1 -Htpasswd 'partneroj:$2y$12$...'
   ```

   Ele baixa o rest-server 0.14.0 e confere o SHA256, cria a pasta com as permissões, a tarefa agendada (no boot, como SYSTEM) e a regra de firewall.
6. Na VPS, instalar o timer: `sudo cp ~/partneroj/infra/production/systemd/partneroj-offsite-copy.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now partneroj-offsite-copy.timer`.

O PC não pode entrar em suspensão, ou fica fora do ar enquanto dorme. Hoje a suspensão automática está desligada.

#### Conferir

```sh
sudo wg show wg0                       # "latest handshake" recente = túnel de pé
docker compose -f infra/production/compose.yml run --rm backup copy-offsite.sh
```

#### Limpar snapshots antigos no PC (uma vez por ano)

Por ser append-only, a cópia de casa só cresce. A limpeza é feita **no próprio PC**, nunca pela rede. Num PowerShell como administrador, com o [restic para Windows](https://github.com/restic/restic/releases):

```powershell
$env:RESTIC_REPOSITORY = 'G:\partneroj-backup\partneroj'
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
```

Ele pede a senha do restic (a mesma do `.env`).

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

## Monitoramento

O **Uptime Kuma** roda na VPS e avisa no celular pelo **ntfy**. O que ele vigia:

| Monitor | Tipo | Alerta quando |
| --- | --- | --- |
| API | HTTP em `https://partneroj.com.br/api/health`, a cada 60 s | a API não responde, ou o certificado vence em menos de 14 dias |
| Backup diário | Push (heartbeat), intervalo de 26 h | um backup falha, ou nenhum chega em 26 h |
| Teste de restauração | Push (heartbeat), intervalo de 8 dias | um teste falha, ou nenhum chega em 8 dias |
| Cópia fora do servidor | Push (heartbeat), intervalo de 3 dias | uma cópia falha, ou nenhuma dá certo em 3 dias (plano, seção 11) |

O backup, o teste e a cópia avisam o Kuma ao terminar (`up`) ou ao falhar (`down`). Um PC desligado não é falha: a cópia simplesmente não acontece, e só depois de 3 dias sem nenhuma cópia o Kuma avisa. Se um deles nem chegar a rodar (container quebrado, timer parado, servidor desligado), o aviso que não chega dispara o alerta do mesmo jeito.

### Vigilância de fora da VPS (Healthchecks.io)

O Kuma está na mesma VPS: se ela cair inteira, ele cai junto e não avisa. Por isso a VPS manda, a cada 5 minutos, um "estou viva" para o **Healthchecks.io**, um serviço de fora (software BSD, que também pode ser auto-hospedado). Se o sinal parar por mais de 15 minutos (período de 5 mais tolerância de 10), ele avisa pelo **mesmo tópico do ntfy**.

O script (`infra/production/heartbeat-external.sh`) só manda o sinal se o **Kuma estiver saudável**. Se o Kuma estiver parado ou doente, ele manda `/fail`, que avisa na hora. Assim:

| O que cai | Quem avisa |
| --- | --- |
| A API, um backup, o teste de restauração, a cópia | Uptime Kuma |
| O Uptime Kuma | Healthchecks.io, na hora |
| A VPS inteira (ou a rede dela) | Healthchecks.io, em até 15 min |

#### Configurar (uma vez)

1. Em https://healthchecks.io, criar um check `Partneroj VPS` com período de **5 minutos** e tolerância (*grace time*) de **10 minutos**.
2. Em **Integrations**, adicionar o **ntfy** com o mesmo tópico e o servidor `https://ntfy.sh`, e ligá-lo para esse check.
3. Colocar a *Ping URL* no `.env` do servidor: `HEALTHCHECKS_PING_URL=https://hc-ping.com/<uuid>`.
4. Instalar o timer: `sudo cp ~/partneroj/infra/production/systemd/partneroj-heartbeat.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now partneroj-heartbeat.timer`.

### Abrir o painel

O painel não fica na internet. Ele escuta só em `127.0.0.1:3001` do servidor, e você chega até ele por um túnel SSH:

```sh
ssh -N -L 3001:localhost:3001 partneroj
# e abra http://localhost:3001 no navegador; Ctrl+C fecha o túnel
```

### Configurar (uma vez)

Os nomes dos menus abaixo são os da tradução para português e podem variar um pouco entre versões do Kuma.

1. **No celular:** instale o app **ntfy** (Android ou iOS) e assine um tópico com nome **longo e aleatório**, por exemplo o resultado de `openssl rand -hex 12` com o prefixo `partneroj-`. Quem souber o nome do tópico vê os alertas e pode mandar alertas falsos, por isso ele funciona como uma senha.
2. **No painel**, na primeira vez: escolha o banco **SQLite** (embutido, guardado no volume `uptime-kuma-data`) e crie o usuário administrador com uma senha forte. Guarde a senha no gerenciador de senhas.
3. **Configurações → Notificações → Configurar notificação:** tipo **ntfy**, servidor `https://ntfy.sh` e o tópico do passo 1. Marque **Ativado por padrão** e **Aplicar em todos os monitores existentes**. Clique em **Testar**: a notificação deve chegar no celular.
4. **Adicionar monitor**, três vezes:
   - **HTTP(s)**, nome `API`, URL `https://partneroj.com.br/api/health`, intervalo 60 s, 2 tentativas. Em Avançado, marque **Notificação de vencimento do certificado**.
   - **Push**, nome `Backup diário`, intervalo de heartbeat `93600` (26 h).
   - **Push**, nome `Teste de restauração`, intervalo de heartbeat `691200` (8 dias).
   - **Push**, nome `Cópia fora do servidor`, intervalo de heartbeat `259200` (3 dias).
5. Cada monitor **Push** mostra uma URL `http://localhost:3001/api/push/<token>?status=up&msg=OK&ping=`. No `.env` do servidor, guarde só o começo dela, com o host trocado pelo nome do serviço:

   ```sh
   BACKUP_PUSH_URL=http://uptime-kuma:3001/api/push/<token do backup>
   RESTORE_CHECK_PUSH_URL=http://uptime-kuma:3001/api/push/<token do teste>
   OFFSITE_PUSH_URL=http://uptime-kuma:3001/api/push/<token da cópia>
   ```

   O token é um segredo: quem tiver um pode fingir que o backup rodou.

6. Rodar um backup e um teste na hora, e conferir que os dois monitores ficam verdes:

   ```sh
   sudo systemctl start partneroj-backup.service partneroj-restore-check.service
   ```

## Chaves do Web Push (VAPID)

As notificações push são assinadas com um par de chaves **VAPID**. Ele é gerado **uma única vez**, no servidor, e **nunca muda**: cada inscrição de push feita por um celular fica presa à chave pública. Com chaves novas, todas as inscrições param de funcionar sem nenhum erro visível, e cada sócio teria de reativar as notificações.

- A **API** recebe só a `VAPID_PUBLIC_KEY`, que entrega ao navegador na inscrição.
- O **worker** recebe também a `VAPID_PRIVATE_KEY`, porque é ele quem envia os pushes. Uma API invadida não consegue assinar um push.
- O `subject` é `https://partneroj.com.br`, sem e-mail.

Gerar, só se ainda não houver `VAPID_` no `.env`:

```sh
cd ~/partneroj
grep -q '^VAPID_PUBLIC_KEY=' infra/production/.env || \
  docker run --rm -v "$PWD/infra/production:/s:ro" node:26-alpine \
    node /s/generate-vapid-keys.mjs >> infra/production/.env
```

**As duas chaves vão para o gerenciador de senhas**, como o resto do `.env`. Se o servidor for perdido, elas precisam voltar iguais.

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
