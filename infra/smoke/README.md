# Smoke test: HTTPS and Web Push

Block 0 check that the VPS serves HTTPS on `partneroj.com.br` and that a push reaches a phone. This code is thrown away later. The real push comes in block 5.

- `vapid.js`: VAPID keys and the ES256 JWT, with `node:crypto` only.
- `server.js`: serves the test page and stores subscriptions. It has no send route on purpose, and it keeps at most 20 subscriptions.
- `endpoints.js`: the push services we accept (Google, Mozilla, Apple, Microsoft). Anything else is refused, to block SSRF.
- `send.js`: sends an empty push (no payload), so the service worker shows a fixed text.

## Run on the VPS

```sh
rsync -a --delete infra/smoke/ partneroj:~/smoke/
ssh partneroj 'cd ~/smoke && docker compose up -d --build'
```

1. On the phone, open `https://partneroj.com.br`, type a name and tap **Ativar avisos**.
2. Send the push:

   ```sh
   ssh partneroj 'cd ~/smoke && docker compose exec push node send.js'
   ```

The VAPID keys and subscriptions live in the `push_data` volume, never in git.
