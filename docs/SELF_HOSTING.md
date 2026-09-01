# Self-hosting fusioneer

Single Docker VPS at your domain. One process: Hono webhook + SQLite WAL queue + worktree executor.

## 1. VPS setup

```bash
# On VPS (Ubuntu)
git clone https://github.com/sardonic-labs/fusioneer && cd fusioneer
cp .env.example .env
# edit .env:
#  ANTHROPIC_API_KEY=...
#  GITHUB_TOKEN= # PAT repo+workflow or GitHub App token
#  GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)
#  FUSIONEER_ALLOW_REPOS=sardonic-labs/sourced,sardonic-labs/fiducial
#  FUSIONEER_DOMAIN=https://fusioneer.yourdomain.xyz
#  PORT=3000  DATA_DIR=./data
bun fusioneer doctor
docker compose up -d
curl -fsS http://localhost:3000/health
```

`docker-compose.yml` mounts `fusioneer-data:/data` for SQLite (`data/fusioneer.db` WAL) and JSONL `data/events/YYYY-MM.jsonl`, plus optional `/var/run/docker.sock` only if you build inside containers.

## 2. Domain + TLS

Use Cloudflare Tunnel or Caddy/Nginx:

```bash
cloudflared tunnel --url http://localhost:3000
# set FUSIONEER_DOMAIN to your https://... and add secret to GitHub repo Settings → Secrets → FUSIONEER_DOMAIN
```

## 3. GitHub webhook

Settings → Webhooks → Add webhook:
- Payload URL: `https://fusioneer.yourdomain.xyz/webhook/github`
- Content type: `application/json`
- Secret: same as `GITHUB_WEBHOOK_SECRET`
- Events: Issues, Pull requests, Issue comments, PR review comments
- Workflow `.github/workflows/fusioneer.yml` already forwards `fusioneer:auto` labels and `/fusioneer` comments via `curl $FUSIONEER_DOMAIN/webhook/github` with `X-GitHub-Delivery` for dedupe.

## 4. Per-repo install

```bash
git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer
./.opencode/fusioneer/bootstrap.sh        # copies agents, fusioneer.json, REVIEW.md, workflow
./.opencode/fusioneer/bootstrap.sh --dry-run  # preview
./.opencode/fusioneer/bootstrap.sh --update   # overwrite
git add .opencode GLOBAL_CTX.md .github/workflows/fusioneer.yml && git commit -m "chore: install fusioneer agents"
```

`FUSIONEER_ALLOW_REPOS` gates execution. Verify cmd per-repo in `.opencode/fusioneer.json` (`bun run check` or `python fiducial/scripts/fiducial.py lint && ...`).

## 5. Dashboard

- `GET /health` → `{ok:true}` (unauthenticated, for load-balancer)
- `GET /jobs` → last 50 (requires `Authorization: Bearer $FUSIONEER_DASHBOARD_TOKEN` if set)
- `GET /jobs/:id` + `GET /jobs/:id/logs` + `GET /jobs/:id/logs/stream` (SSE, polls every 2s) — same Bearer auth
- `GET /agents` — same auth
- `FUSIONEER_DASHBOARD_TOKEN` empty → open in dev, warning in `NODE_ENV=production`. Generate with `openssl rand -hex 32`.

Data persisted in SQLite — restart re-queues `queued` jobs. Tail JSONL `data/events/YYYY-MM.jsonl`.

## 6. Hardening

- Webhook: `X-Hub-Signature-256` HMAC, `X-GitHub-Delivery` dedupe, `512KB` payload cap, `60 req/min` per-IP rate-limit, `repo` format `owner/name` validated, `issue` 1..1M, `FUSIONEER_ALLOW_REPOS` allowlist, max 3 jobs per `repo#issue` (revision cap).
- Dashboard: optional `Bearer` token (constant-time compare), `401` without token when configured; rate-limited same bucket.
- Headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CSP: default-src 'none'`.
- `opencode.json` `permission` denies `gh pr merge*`, `rm -rf`, `.env` reads; see `src/policy-guard.ts`.
- Daily backup: `sqlite3 data/fusioneer.db .dump | gzip > backup.sql.gz`.
- `docker-compose.yml` runs `NODE_ENV=production` + `DATA_DIR=/data`; optionally set `read_only: true` + `no-new-privileges`.

## 7. Update

```bash
git submodule update --remote .opencode/fusioneer
./.opencode/fusioneer/bootstrap.sh --update
```
