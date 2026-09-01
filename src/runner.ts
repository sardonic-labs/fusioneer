import { $ } from "bun";
import { hasFiducialDir, loadFusioneerConfig, readGlobalCtx, readReviewMd, resolveVerifyCmd } from "./config.ts";
import { PHASES, runOpencodePhase, createDraftPr } from "./phases.ts";
import { createWorktree } from "./worktree.ts";

export type RunnerOpts = {
  repo: string;
  issue: number;
  type?: string;
  model?: string;
  dryRun?: boolean;
};

async function fetchIssueTitle(repo: string, issue: number): Promise<string> {
  try {
    const proc = Bun.spawn(["gh", "issue", "view", String(issue), "--repo", repo, "--json", "title", "--jq", ".title"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code === 0 && out.trim()) return out.trim();
  } catch {}
  return `issue-${issue}`;
}

export async function run(opts: RunnerOpts): Promise<void> {
  const { repo, issue } = opts;
  if (!repo || !issue) throw new Error("usage: bun fusioneer run --repo owner/name --issue N");

  const issueTitle = await fetchIssueTitle(repo, issue);
  console.log(`[fusioneer] repo=${repo} issue=#${issue} title="${issueTitle}" dryRun=${!!opts.dryRun}`);

  const handle = await createWorktree({ repo, issue, issueTitle, type: opts.type });
  console.log(`[fusioneer] worktree ${handle.worktreeDir} branch ${handle.branch}`);

  // Load per-repo config from cloned worktree
  const cfg = await loadFusioneerConfig(handle.worktreeDir);
  const hasFiducial = await hasFiducialDir(handle.worktreeDir);
  const verifyCmd = resolveVerifyCmd(cfg, hasFiducial);
  const globalCtx = await readGlobalCtx(handle.worktreeDir);
  const reviewMd = await readReviewMd(handle.worktreeDir);

  console.log(`[fusioneer] verify="${verifyCmd}" fiducial=${hasFiducial}`);

  // Ensure deps for verify (bun install) if package.json exists
  try {
    const hasPkg = await Bun.file(`${handle.worktreeDir}/package.json`).exists();
    if (hasPkg) {
      console.log("[fusioneer] installing deps in worktree...");
      await $`bun install --frozen-lockfile`.cwd(handle.worktreeDir).quiet();
    }
  } catch (e) {
    console.warn("[fusioneer] bun install failed: " + String(e));
  }

  let failed = false;
  try {
    for (const phase of PHASES) {
      if (opts.dryRun && phase === "pr") {
        console.log(`[fusioneer] dryRun: skipping pr phase`);
        continue;
      }
      console.log(`[fusioneer] phase ${phase}...`);
      const res = await runOpencodePhase({
        worktreeDir: handle.worktreeDir,
        phase,
        repo,
        issue,
        globalCtx,
        reviewMd,
        verifyCmd,
        model: opts.model,
      });
      console.log(`[fusioneer] phase ${phase} exit=${res.exitCode}`);
      if (res.output) console.log(res.output.slice(0, 4000));

      if (res.exitCode !== 0) {
        console.error(`[fusioneer] phase ${phase} failed — aborting`);
        failed = true;
        break;
      }

      // After implement, ensure something changed before verify/pr
      if (phase === "implement") {
        const diff = await $`git -C ${handle.worktreeDir} status --porcelain`.text();
        if (!diff.trim()) console.warn("[fusioneer] no changes after implement");
      }

      // pr phase: push + gh pr create (handled inside phases via opencode, but fallback here)
      if (phase === "pr" && !opts.dryRun) {
        // Auto-clean PLAN.md — internal planning artifact, not part of PR diff
        try {
          await $`rm -f ${handle.worktreeDir}/PLAN.md`.quiet();
          // If PLAN.md was already tracked (shouldn't be), untrack it without deleting
          await $`git -C ${handle.worktreeDir} rm --cached --ignore-unmatch PLAN.md`.quiet().catch(() => {});
        } catch {}
        const hasDiff = (await $`git -C ${handle.worktreeDir} status --porcelain`.text()).trim();
        if (hasDiff) {
          await $`git -C ${handle.worktreeDir} add -A`.quiet();
          await $`git -C ${handle.worktreeDir} commit -m ${`feat: ${issueTitle} (#${issue})`}`.quiet().catch(() => {});
        }
        try {
          await createDraftPr(handle.worktreeDir, handle.branch, issue, issueTitle);
          console.log("[fusioneer] draft PR created");
        } catch (e) {
          console.warn("[fusioneer] gh pr create failed (may already exist): " + String(e));
        }
      }
    }
  } finally {
    if (failed || opts.dryRun) {
      console.log(`[fusioneer] cleaning up ${handle.tmpRoot}`);
      await handle.cleanup();
    } else {
      console.log(`[fusioneer] keeping worktree at ${handle.tmpRoot} (push done)`);
      // Optionally cleanup after push; keep for now to allow inspection
      // await handle.cleanup();
    }
  }

  if (failed) process.exit(1);
}

function parseArgs(argv: string[]): RunnerOpts {
  const opts: RunnerOpts = { repo: "", issue: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1]) opts.repo = argv[++i]!;
    else if (a?.startsWith("--repo=")) opts.repo = a.split("=")[1]!;
    else if (a === "--issue" && argv[i + 1]) opts.issue = Number(argv[++i]!);
    else if (a?.startsWith("--issue=")) opts.issue = Number(a.split("=")[1]);
    else if (a === "--type" && argv[i + 1]) opts.type = argv[++i]!;
    else if (a?.startsWith("--type=")) opts.type = a.split("=")[1];
    else if (a === "--model" && argv[i + 1]) opts.model = argv[++i]!;
    else if (a?.startsWith("--model=")) opts.model = a.split("=")[1];
    else if (a === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

// If invoked directly via `bun src/runner.ts ...` or `bun fusioneer run ...`
if (import.meta.main) {
  const args = process.argv.slice(2);
  // Support both `bun src/runner.ts --repo ...` and `bun fusioneer run --repo ...`
  const filtered = args[0] === "run" ? args.slice(1) : args;
  const opts = parseArgs(filtered);
  if (!opts.repo || !opts.issue) {
    console.error("usage: bun src/runner.ts --repo owner/name --issue N [--type feat] [--model provider/model] [--dry-run]");
    console.error("   or: bun fusioneer run --repo owner/name --issue N ...");
    process.exit(2);
  }
  await run(opts);
}
