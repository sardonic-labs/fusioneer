# Contributing to fusioneer

> 4 steps: **Issue → Branch → PR (Closes #) → Merge → Close**. `main` is protected — PR must be green.

## 1. Open an issue

Don’t start code without an issue. Search open issues first.

* Bug: repro + expected vs actual
* Feature: use-case + sketch (e.g. new agent type or trigger)
* Docs: label `documentation`

Title like `feat: add cron trigger` or `fix: verify exit code handling`. The issue number (`#42`) is used in branch + PR.

## 2. Branch from `main`

```sh
git fetch origin main
git checkout main && git pull --ff-only origin main
# fusioneer branch format (matches src/worktree.ts:branchName): fusioneer/<type>-<issue>-<slug>
git checkout -b fusioneer/feat-42-cron-trigger
# type: feat | fix | docs | chore  (slug auto-truncated to 40 chars)
```

Alternative local shorthand `<type>/<short-slug>-#<issue>` (e.g. `feat/cron-trigger-#42`) is accepted but CI normalizes to `fusioneer/<type>-<issue>-<slug>`.

One issue per branch. Branch must contain `#<issue>` or `fusioneer/<type>-<issue>-`. Never commit directly to `main`.

## 3. PR with issue link

```sh
git add <files> && git commit -m "feat: short description (#42)"
git push -u origin fusioneer/feat-42-cron-trigger
gh pr create --title "feat: add cron trigger (#42)" --body "Closes #42"
```

Body must contain `Closes #<issue>` — GitHub auto-closes on merge. Use **Squash and merge**.

PR checklist (copy into body):

```md
Closes #42
- [ ] `bun run check` (`tsc --noEmit`) clean
- [ ] docs updated (`PLAN.md`/`README.md`/`GLOBAL_CTX.md`) if behavior changed
- [ ] single concern, no stray `*.db`/`*.log`
```

## 4. Merge → close

* CI must be green (see `.github/workflows/ci.yml`).
* Maintainer approves.
* On merge GitHub deletes branch — `git pull` and `git branch -d <branch>` locally.

Questions? Open an issue labeled `documentation` or see `PLAN.md`.
