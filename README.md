# Partneroj

> 🚧 Work in progress, started in November 2026.

An open-source API and web app for business partners to manage a shared venture together: expenses with receipts, a notification to everyone on every entry, voting to dispute an entry, and a final settlement based on each partner's share.

Its first real use is the construction of a house shared by three partners from the same family, starting in January 2027.

*Partneroj* is Esperanto for "partners".

## Core ideas

- **Money as integer cents** (`bigint`), never floating point.
- **Immutable entries:** mistakes are fixed with a reversal entry, never by editing or deleting.
- **A tested invariant:** the sum of the partners' balances always equals the sum of the accounts' balances.
- **Full transparency:** every partner sees everything and gets notified of every entry.
- **Fair splits:** shares are integer weights, and rounding uses the largest remainder method, so equal partners never differ by more than one cent.

## Planned stack

TypeScript · NestJS · PostgreSQL + Drizzle · pg-boss · React + Vite (PWA) · Web Push · Passkeys · Vitest + Testcontainers + Playwright · Docker Compose · Caddy

## Technical decisions

Every significant decision is recorded as an ADR in [`docs/adr/`](docs/adr/).

## Disclaimer

Partneroj does not replace an accountant and does not determine who owns an asset. It records who contributed how much.

## License

[MIT](LICENSE)
