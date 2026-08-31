# fusioneer

[![CI](https://github.com/sardonic-labs/fusioneer/actions/workflows/ci.yml/badge.svg)](https://github.com/sardonic-labs/fusioneer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.4-black?logo=bun)](https://bun.sh)
[![opencode](https://img.shields.io/badge/opencode-run-blue)](https://opencode.ai)

Home managed agents on `opencode run` — define agents that run 24/7, per repo.

> Single Dockerized VPS process at your domain. Inspired by `coalesce-labs/catalyst`, built on [opencode](https://opencode.ai).

## Concept

You label a GitHub issue `fusioneer:auto` (or open a PR) — a 24/7 supervisor on your VPS picks it up, spawns isolated `opencode run` worktrees through a `triage→plan→implement→verify→pr` pipeline, and lands a verified draft PR. Comment `/fusioneer revise: ...` on the PR to re-queue a revision on the same branch.

* **Per-repo agents** — each repo commits `.opencode/agents/issue-tackle.md` + `pr-review.md` + `.opencode/fusioneer.json` (verify cmd, triggers). Install via `git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer && .opencode/fusioneer/bootstrap.sh`.
* **One process** — Hono webhook `POST /webhook/github` (HMAC) + SQLite queue + `p-queue` executor (`maxParallel=2`, per-repo 1) + dashboard `GET /jobs`.
* **Memory** — `GLOBAL_CTX.md` (repo root) + per-type `REVIEW.md` injected via `instructions`, not persistent `serve` sessions.
* **Free-model first** — `steps:80`, `doom_loop:ask`, no USD cap needed.

## Quick start

```bash
bun install
# VPS
cp .env.example .env  # ANTHROPIC_API_KEY, GITHUB_TOKEN, FUSIONEER_ALLOW_REPOS
docker compose up -d  # webhook at https://fusioneer.yourdomain.xyz/webhook/github
# per repo
git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer
./.opencode/fusioneer/bootstrap.sh
```

See [`PLAN.md`](./PLAN.md) for architecture, pipeline, and phases.

## Development

```bash
bun run index.ts
bun tsc --noEmit
```

Requires Bun 1.4+, opencode, `gh` CLI. License [MIT](./LICENSE).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Flow: `Issue → Branch type/slug-#issue → PR Closes # → Squash merge`.

## Security

See [SECURITY.md](./SECURITY.md). Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
