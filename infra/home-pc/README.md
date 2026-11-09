# Home PC

The home PC keeps an off-site copy of the backups. It sits behind CGNAT, so it opens a WireGuard tunnel to the VPS, and the VPS copies new restic snapshots to a rest-server on the PC through it.

- `setup-rest-server.ps1`: run once as administrator. It installs rest-server 0.14.0 (checksum verified) in append-only mode with private repos, as a boot-time scheduled task running as SYSTEM. Data goes to `G:\partneroj-backup`, readable only by SYSTEM and Administrators. Port 8000 is open only to `10.77.0.1` on the `partneroj` tunnel.

The full procedure (WireGuard on both ends, the VPS timer, checks and yearly pruning on the PC) is in [docs/operacao.md](../../docs/operacao.md) (in Portuguese).
