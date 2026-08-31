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
  const body = opts.extra ?? "";
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
    ["opencode", "run", "--agent", agent, "--format", "json", ...model, prompt],
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
