# Production stack

Docker Compose stack that runs on the VPS: Postgres, a one-shot `migrate` step, the API, the worker, and Caddy serving the web app and the block 0 prototype over HTTPS. Uptime Kuma watches the API and the backups and alerts through ntfy; its panel listens on the server's loopback only. A `backup` service, started only on demand, backs up the database into a local restic repository and tests restores. The images are built on the server.

- `compose.yml`: the services. The API and the worker log in as `partneroj_api`, which has the restricted `partneroj_app` role (migration `0006`). Only `migrate` uses the owner of the tables.
- `Dockerfile`: the `app` target (API, worker and migrate), the `web` target (Caddy with the built front end) and the `backup` target (Postgres 18 with restic).
- `Caddyfile`: `/api/*` goes to the API, `/prototipo/` serves the prototype, and every other path serves the web app.
- `deploy.sh`: deploys `origin/main`, or a given commit, from your computer, with a backup right before the migrations.
- `backup/`: `backup.sh` (pg_dump and roles into restic, with retention) and `restore-check.sh` (restores into a throwaway Postgres and checks the insert-only tables against production).
- `systemd/`: timers for the nightly backup, the weekly restore check and the hourly off-site copy to the home PC (`backup/copy-offsite.sh`, through WireGuard; see `infra/home-pc/`). Both scripts push their result to an Uptime Kuma push monitor (`backup/heartbeat.sh`).
- `.env.example`: the secrets the server needs.

How to deploy, roll back, back up, restore and rotate passwords: [docs/operacao.md](../../docs/operacao.md) (in Portuguese).
