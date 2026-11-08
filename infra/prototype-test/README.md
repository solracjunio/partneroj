# Prototype guided test (block 0)

Serves the clickable prototype and collects the events of a guided test, so a partner can test it alone on their own phone. Like `infra/smoke`, it is retired: since the production stack (`infra/production`) took over ports 80 and 443, its Caddy serves the prototype and the collector no longer runs.

- **Caddy** serves `prototype/` at `/prototipo/` and forwards `POST /coleta` to the collector (bodies above 64 KB are cut).
- **collector.js** appends each batch of events to `data/<label>.jsonl`. It has no dependencies.
- **report.js** turns a collected file into a readable report: tasks, seconds, taps outside buttons, error messages, the path taken and the answers.

## What is collected

`prototype/test.js` only runs when the link has `teste=<secret>`. It records task times, screens, which buttons were tapped (by their role, never by the names written on them), error messages, the phone model and the final answers. It never records photos, typed amounts or names. The first screen of the test tells the person all of this.

## Abuse

The repository is public, so anyone can read this code and find `/coleta`. The collector:

- accepts only the secret tokens in `.env` (403 otherwise). The secret lives only in the link sent to each partner, never in git;
- accepts at most 30 requests per minute per token, 300 events per request and 2,500 characters per event;
- stops writing when a file passes 20 MB;
- runs read-only, with no Linux capabilities and no new privileges. Only Caddy publishes ports.

## Deploy

```sh
# once: create .env on the server from .env.example, with one token per person
rsync -a --exclude .env --exclude data infra/prototype-test/ partneroj:~/prototype-test/
rsync -a --delete --exclude README.md prototype/ partneroj:~/prototype-test/prototipo/
ssh partneroj 'cd ~/prototype-test && docker compose up -d --build'
```

## Reading the results

```sh
scp partneroj:~/prototype-test/data/<label>.jsonl /tmp/
node infra/prototype-test/report.js /tmp/<label>.jsonl
```

The collected files are the partners' data: they stay on the server and on your computer, never in git (`data/` is in `.gitignore`).
