import { $ } from "bun";

export type Phase = "triage" | "plan" | "implement" | "verify" | "pr";
export const PHASES: Phase[] = ["triage", "plan", "implement", "verify", "pr"];

export type PhaseResult = {
  phase: Phase;
  exitCode: number;
  output: string;
};

function buildPrompt(opts: {
  phase: Phase;
  repo: string;
  issue: number;
  globalCtx: string;
  reviewMd: string;
  verifyCmd: string;
  extra?: string;
}): string {
  const header = `Repo: ${opts.repo} Issue: #${opts.issue} Phase: ${opts.phase}`;
  const verify = `Verify command: \`${opts.verifyCmd}\``;
  const ctx = [opts.globalCtx, opts.reviewMd].filter(Boolean).join("\n\n---\n\n");
  const phaseInstructions: Record<Phase, string> = {
    triage: `You are in TRIAGE phase. Read issue #${opts.issue} via "gh issue view ${opts.issue} --repo ${opts.repo} --json title,body,labels,comments" (use --repo flag). Check labels, decide in-scope. Do not edit code. Output a short triage report. Worktree is at current dir.`,
    plan: `You are in PLAN phase. Read the triage output and issue. Write PLAN.md in worktree root (repo root) with: Problem, Approach, Files to change, Verify command. Be concise. This file must exist for next phase.`,
    implement: `You are in IMPLEMENT phase. Read PLAN.md and issue #${opts.issue} via "gh issue view ${opts.issue} --repo ${opts.repo} --json title,body" and make the minimal edits to satisfy the plan. Keep diff minimal.`,
    verify: `You are in VERIFY phase. Run the verify command: \`${opts.verifyCmd}\` via bash in worktree. Report exit code. Do not claim clean without running it. If python not found, try python3.`,
    pr: `You are in PR phase. First remove PLAN.md if it exists (rm -f PLAN.md; git rm --cached --ignore-unmatch PLAN.md) — it is an internal planning artifact and must NOT be committed or included in the PR diff. Then verify git diff, commit and push branch fusioneer/<type>-<n>-<slug>, create draft PR with "Closes #${opts.issue}". Skip if dry-run.`,
  };
  const body = opts.extra ?? phaseInstructions[opts.phase];
  return [header, verify, ctx, body].filter(Boolean).join("\n\n");
}

export async function runOpencodePhase(opts: {
  worktreeDir: string;
  phase: Phase;
  repo: string;
  issue: number;
  globalCtx: string;
  reviewMd: string;
  verifyCmd: string;
  extra?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<PhaseResult> {
  const prompt = buildPrompt(opts);
  const agent = "issue-tackle";
  const model = opts.model ? ["--model", opts.model] : [];
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;

  const proc = Bun.spawn(
    ["opencode", "run", "--agent", agent, "--format", "json", "--dir", opts.worktreeDir, ...model, prompt],
    {
      cwd: opts.worktreeDir,
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const timeout = setTimeout(() => {
    try {
      proc.kill();
    } catch {}
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);

  const output = [stdout, stderr].filter(Boolean).join("\n");

  // Verify phase also runs the verify command directly (exit code check)
  if (opts.phase === "verify") {
    try {
      const verifyProc = Bun.spawn(["bash", "-c", opts.verifyCmd], {
        cwd: opts.worktreeDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [vOut, vErr, vCode] = await Promise.all([
        new Response(verifyProc.stdout).text(),
        new Response(verifyProc.stderr).text(),
        verifyProc.exited,
      ]);
      const vOutput = [vOut, vErr].filter(Boolean).join("\n");
      return {
        phase: opts.phase,
        exitCode: vCode,
        output: output + "\n\n[verify cmd: " + opts.verifyCmd + " exit=" + vCode + "]\n" + vOutput,
      };
    } catch (e) {
      return { phase: opts.phase, exitCode: 1, output: output + "\n[verify spawn failed: " + String(e) + "]" };
    }
  }

  return { phase: opts.phase, exitCode, output };
}

export async function runVerifyCmd(worktreeDir: string, cmd: string): Promise<PhaseResult> {
  const proc = Bun.spawn(["bash", "-c", cmd], {
    cwd: worktreeDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { phase: "verify", exitCode: code, output: [out, err].filter(Boolean).join("\n") };
}

export async function createDraftPr(worktreeDir: string, branch: string, issue: number, title: string): Promise<void> {
  // Push branch
  await $`git -C ${worktreeDir} push -u origin ${branch}`.quiet();
  const prTitle = `${title} (#${issue})`;
  const prBody = `Closes #${issue}\n\nAutomated by fusioneer \`issue-tackle\` pipeline.`;
  await $`gh pr create --draft --title ${prTitle} --body ${prBody}`.cwd(worktreeDir).quiet();
}
