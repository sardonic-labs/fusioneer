import { $ } from "bun";
import { hasFiducialDir, loadFusioneerConfig, readGlobalCtx, readReviewMd, resolveVerifyCmd } from "./config.ts";
import { PHASES, runOpencodePhase, createDraftPr } from "./phases.ts";
import { createWorktree, branchName } from "./worktree.ts";
import { updateJob, appendJobLogs, appendEvent } from "./db.ts";
import { isRepoAllowed } from "./policy-guard.ts";

export type ExecuteOpts = {
  jobId: string;
  repo: string;
  issue: number;
  issueTitle?: string;
  type?: string;
  deliveryId?: string;
  payload?: unknown;
  revisionBody?: string | null;
};

export async function executeJob(opts: ExecuteOpts): Promise<{ success: boolean; branch?: string; exitCode?: number }> {
  const { jobId, repo, issue } = opts;
  if (!isRepoAllowed(repo)) {
    appendJobLogs(jobId, `\n[policy] repo ${repo} not in FUSIONEER_ALLOW_REPOS — skipping\n`);
    updateJob(jobId, { status: "skipped", finished_at: new Date().toISOString(), phase: "triage" });
    appendEvent(jobId, "job.skipped", { repo, reason: "allowlist" });
    return { success: false, exitCode: 2 };
  }

  const issueTitle = opts.issueTitle ?? `issue-${issue}`;
  let handle: Awaited<ReturnType<typeof createWorktree>> | null = null;
  try {
    updateJob(jobId, { status: "running", started_at: new Date().toISOString(), phase: "triage" });
    appendEvent(jobId, "job.running", { repo, issue, branch: "" });

    // Handle revision: if revisionBody provided, we need to fetch existing branch
    // For now, create new worktree with same branch name logic; if revision, we'll reuse branch and force-push later
    handle = await createWorktree({ repo, issue, issueTitle, type: opts.type ?? "feat" });
    const branch = handle.branch;
    updateJob(jobId, { branch, phase: "triage" });
    appendJobLogs(jobId, `[executor] worktree ${handle.worktreeDir} branch ${branch}\n`);

    // If revision, try to fetch previous PLAN.md and diff from payload? For now inject previous plan if payload contains
    if (opts.revisionBody) {
      appendJobLogs(jobId, `[executor] revision trigger: ${opts.revisionBody.slice(0, 500)}\n`);
      // Inject previous PLAN.md context via extra prompt handling is done in phases; we just log
    }

    const cfg = await loadFusioneerConfig(handle.worktreeDir);
    const hasFiducial = await hasFiducialDir(handle.worktreeDir);
    const verifyCmd = resolveVerifyCmd(cfg, hasFiducial);
    const globalCtx = await readGlobalCtx(handle.worktreeDir);
    const reviewMd = await readReviewMd(handle.worktreeDir);

    // Check label gate via config (if payload has label, we already gate at webhook)
    // Check revision gate
    if (opts.revisionBody && cfg.revision) {
      const triggers = cfg.revision.triggers ?? ["/fusioneer", "/revise"];
      const max = cfg.revision.maxRevisions ?? 3;
      // Need to fetch current revision count from DB: count jobs for same repo+issue with status success
      // For now trust caller; we already validated in webhook
    }

    appendJobLogs(jobId, `[executor] verify="${verifyCmd}" fiducial=${hasFiducial}\n`);

    // Ensure deps for verify (bun install) if package.json exists
    try {
      const hasPkg = await Bun.file(`${handle.worktreeDir}/package.json`).exists();
      if (hasPkg) {
        appendJobLogs(jobId, `[executor] bun install in worktree...\n`);
        await $`bun install --frozen-lockfile`.cwd(handle.worktreeDir).quiet();
      }
    } catch (e) {
      appendJobLogs(jobId, `[executor] bun install failed: ${String(e)}\n`);
    }

    let failed = false;
    let exitCode = 0;
    const useStructured = process.env.FUSIONEER_STRUCTURED === "1";
    for (const phase of PHASES) {
      updateJob(jobId, { phase });
      appendJobLogs(jobId, `\n[executor] phase ${phase}...${useStructured ? " (structured)" : ""}\n`);
      appendEvent(jobId, "phase.start", { phase });

      // For revision, inject previous diff + body into extra for implement phase
      let extra: string | undefined;
      if (phase === "implement" && opts.revisionBody) {
        try {
          const diff = await $`git -C ${handle.worktreeDir} diff HEAD`.text().catch(() => "");
          extra = `Revision request: "${opts.revisionBody}"\n\nPrevious diff (if any):\n${diff.slice(0, 8000)}\n\nApply revision on same branch.`;
        } catch {}
      }

      // Phase 4: structured output via createOpencode for triage/plan when enabled
      let res: Awaited<ReturnType<typeof runOpencodePhase>>;
      if (useStructured && (phase === "triage" || phase === "plan")) {
        try {
          const { createOpencode } = await import("./opencode.ts");
          const oc = createOpencode({ worktreeDir: handle.worktreeDir });
          const prompt = [ `Repo: ${repo} Issue: #${issue} Phase: ${phase}`, `Verify command: \`${verifyCmd}\``, [globalCtx, reviewMd].filter(Boolean).join("\n\n---\n\n"), extra ?? ""].filter(Boolean).join("\n\n");
          const structured = await oc.run(phase as any, prompt);
          appendJobLogs(jobId, `[structured ${phase}] ${JSON.stringify(structured.data).slice(0, 4000)}\n`);
          res = { phase, exitCode: 0, output: JSON.stringify(structured.data, null, 2) + "\n" + structured.raw.slice(0, 4000) };
        } catch (e) {
          appendJobLogs(jobId, `[structured ${phase} fallback] ${String(e).slice(0, 2000)}\n`);
          res = await runOpencodePhase({
            worktreeDir: handle.worktreeDir,
            phase,
            repo,
            issue,
            globalCtx,
            reviewMd,
            verifyCmd,
            extra,
            timeoutMs: 30 * 60 * 1000,
          });
        }
      } else {
        res = await runOpencodePhase({
          worktreeDir: handle.worktreeDir,
          phase,
          repo,
          issue,
          globalCtx,
          reviewMd,
          verifyCmd,
          extra,
          timeoutMs: 30 * 60 * 1000,
        });
      }

      const logChunk = `[phase ${phase} exit=${res.exitCode}]\n${res.output.slice(0, 8000)}\n`;
      appendJobLogs(jobId, logChunk);
      appendEvent(jobId, "phase.finish", { phase, exitCode: res.exitCode });

      if (res.exitCode !== 0) {
        appendJobLogs(jobId, `[executor] phase ${phase} failed — aborting\n`);
        failed = true;
        exitCode = res.exitCode;
        break;
      }

      if (phase === "implement") {
        const diff = await $`git -C ${handle.worktreeDir} status --porcelain`.text();
        if (!diff.trim()) {
          appendJobLogs(jobId, `[executor] no changes after implement\n`);
        }
      }

      if (phase === "pr") {
        // Auto-clean PLAN.md before commit (also handled in runner, but double-guard here)
        try {
          await $`rm -f ${handle.worktreeDir}/PLAN.md`.quiet();
          await $`git -C ${handle.worktreeDir} rm --cached --ignore-unmatch PLAN.md`.quiet().catch(() => {});
        } catch {}
        const hasDiff = (await $`git -C ${handle.worktreeDir} status --porcelain`.text()).trim();
        if (hasDiff) {
          await $`git -C ${handle.worktreeDir} add -A`.quiet();
          await $`git -C ${handle.worktreeDir} commit -m ${`feat: ${issueTitle} (#${issue})`}`.quiet().catch(() => {});
          appendJobLogs(jobId, `[executor] committed changes\n`);
        }
        try {
          await createDraftPr(handle.worktreeDir, branch, issue, issueTitle);
          appendJobLogs(jobId, `[executor] draft PR created\n`);
        } catch (e) {
          // If revision, force push instead
          if (opts.revisionBody) {
            try {
              await $`git -C ${handle.worktreeDir} push --force-with-lease origin ${branch}`.quiet();
              appendJobLogs(jobId, `[executor] force-pushed revision branch\n`);
            } catch (e2) {
              appendJobLogs(jobId, `[executor] force-push failed: ${String(e2)}\n`);
            }
          } else {
            appendJobLogs(jobId, `[executor] gh pr create failed: ${String(e)}\n`);
          }
        }
      }
    }

    const finalStatus = failed ? "failed" : "success";
    updateJob(jobId, {
      status: finalStatus as any,
      finished_at: new Date().toISOString(),
      exit_code: exitCode,
    });
    appendEvent(jobId, `job.${finalStatus}`, { repo, issue, branch, exitCode });

    // Cleanup worktree: keep if success for inspection? But we should clean up to save disk.
    // Keep branch remote, cleanup local worktree
    try {
      await handle.cleanup();
    } catch {}
    return { success: !failed, branch: handle.branch, exitCode };
  } catch (e) {
    const msg = String(e);
    appendJobLogs(jobId, `[executor] fatal: ${msg}\n`);
    updateJob(jobId, { status: "failed", finished_at: new Date().toISOString(), exit_code: 1 });
    appendEvent(jobId, "job.failed", { error: msg });
    if (handle) {
      try {
        await handle.cleanup();
      } catch {}
    }
    return { success: false, exitCode: 1 };
  }
}

export function getBranchForIssue(type: string, issue: number, title: string): string {
  return branchName(type, issue, title);
}
