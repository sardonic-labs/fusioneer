# Fusioneer — Home Managed Agents on `opencode run` (v1)

> Single Dockerized VPS process at your domain. Per-repo agents. No `opencode serve`.

## Context

Home Claude Managed Agents clone. Define agents that run 24/7; primary use auto-tackle issues + auto PR review across select repos (`sardonic-labs/sourced#6`, `fiducial`). Open-source tool you self-host. Derived from `coalesce-labs/catalyst` 10-phase `triage→...→teardown` worktree pipeline and opencode primitives (`opencode run`, agents, config, plugins).

Decisions locked:
- Domain webhook (`POST /webhook/github` HMAC), no polling fallback
- Memory: `GLOBAL_CTX.md` (repo root) + per-type `REVIEW.md` via `instructions: ["GLOBAL_CTX.md", ".opencode/fusioneer/REVIEW.md"]` + `{file:...}` injection
- Free models (`enabled_providers` allowlist), `steps:80`, `doom_loop:ask`
- `verify` per-repo in `.opencode/fusioneer.json`
- PR review via GraphQL review threads (`addPullRequestReviewThreadReply`/`resolveReviewThread`)

## Architecture — one process, worktree children

```
GitHub —webhook HMAC→ VPS https://fusioneer.yourdomain.xyz/webhook/github
                     → Fusioneer (1 Docker: bun + opencode + gh)
                       ├─ Hono webhook receiver (verify + dedupe delivery_id)
                       ├─ Per-repo loader (.opencode/fusioneer.json + .opencode/agents/*.md)
                       ├─ Queue SQLite/WAL (jobs, events) + p-queue maxParallel=2, per-repo 1
                       ├─ Supervisor (24/7 listeners, desired state = enabled agents)
                       ├─ Executor: tmp worktree → sequential `opencode run` phases
                       └─ Dashboard GET /jobs /agents /jobs/:id/logs + ~/fusioneer/events/YYYY-MM.jsonl
Per job: mktemp → git clone --depth1 → git worktree add → for phase in [triage,plan,implement,verify,pr]:
  opencode run --agent <phase> --model <frontmatter> --format json "<prompt + GLOBAL_CTX.md + REVIEW.md + payload>"
```

No global `opencode serve`; each phase is a child process.

## Per-Repo Authoring

```
git submodule add https://github.com/sardonic-labs/fusioneer .opencode/fusioneer
./.opencode/fusioneer/bootstrap.sh
# .opencode/agents/issue-tackle.md  (mode:primary, steps:80)
# .opencode/agents/pr-review.md     (subagent, edit:deny)
# .opencode/fusioneer.json          {triggers, labels:{auto:"fusioneer:auto"}, verify, revision:{triggers:["/fusioneer","/revise"],maxRevisions:3}}
# .github/workflows/fusioneer.yml  on:[issues,pull_request,issue_comment,pull_request_review_comment] → curl VPS
# GLOBAL_CTX.md + .opencode/fusioneer/REVIEW.md
```
VPS allowlist `FUSIONEER_ALLOW_REPOS` gates execution.

## Pipeline

`triaged` comment → `research` → `plan` writes `PLAN.md` → `implement` edits → `verify` runs `fusioneer.json.verify` (`python fiducial/scripts/fiducial.py lint/erc/check-intent` exit 0/1/2 for hardware repos, else `pytest`) → `pr` pushes `fusioneer/<type>-<n>-<slug>` → `gh pr create --draft` (Fixes #n). Revision: `/fusioneer revise: ...` comment on issue/PR thread re-queues same branch with previous `PLAN.md`+diff injected, force-push, max 3.

## Phases

**0 Scaffold 1d:** `opencode.json`, `Dockerfile` (FROM ghcr.io/anomalyco/opencode + gh/bun), `docker-compose.yml`, agent stubs, `GLOBAL_CTX.md`/`REVIEW.md`. Verify `opencode run "ping" --format json`.

**1 Runner PoC 2d:** `src/runner.ts` `bun fusioneer run --repo sardonic-labs/sourced --issue 6` 5-phase worktree loop → draft PR.

**2 Control Plane 3d:** Hono + SQLite jobs/events + worktree executor streaming json + dashboard. Deploy via Cloudflare Tunnel.

**3 Hardening 2d:** GraphQL threads, label gates, permission guards (`external_directory:deny`, `policy-guard.ts`), timeout 30m, bounded handling.

**4 Generalize post-v1:** interval/cron triggers, `createOpencode()` structured output, private gantry after scope.

## Security

HMAC dedupe, `permission` deny on `gh pr merge*` / `rm -rf *`, `policy-guard` denies `.env`, 429 backoff, daily backup.

## Verification

E2E: label `sourced#6` `fusioneer:auto` → job done → PR linked → SSE logs → `/fusioneer revise:` force-push.

## Risks

Idle if few `fusioneer:auto` issues; free-model rate limits; needs `verify` harness for hardware correctness (no `intent.csv` → hallucination risk).

## Prior Art

Catalyst (`coalesce-labs/catalyst` CLAUDE.md/AGENTS.md/how-catalyst-works), opencode CLI `run`/`agents`/`config`/`plugins` docs, fiducial `AGENTS.md`.
