# Production stack

Docker Compose stack that runs on the VPS: Postgres, a one-shot `migrate` step, the API, the worker, and Caddy serving the web app and the block 0 prototype over HTTPS. The images are built on the server.

- `compose.yml`: the services. The API and the worker log in as `partneroj_api`, which has the restricted `partneroj_app` role (migration `0006`). Only `migrate` uses the owner of the tables.
- `Dockerfile`: the `app` target (API, worker and migrate) and the `web` target (Caddy with the built front end).
- `Caddyfile`: `/api/*` goes to the API, `/prototipo/` serves the prototype, and every other path serves the web app.
- `deploy.sh`: deploys `origin/main`, or a given commit, from your computer.
- `.env.example`: the secrets the server needs.

How to deploy, roll back and rotate passwords: [docs/operacao.md](../../docs/operacao.md) (in Portuguese).
