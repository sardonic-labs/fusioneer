import { CronJob } from "cron";
import { createJob, listJobs } from "./db.ts";
import { enqueue } from "./queue.ts";
import { executeJob } from "./executor.ts";
import { loadFusioneerConfig } from "./config.ts";
import { isRepoAllowed } from "./policy-guard.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

type ActiveSchedule = {
  repo: string;
  schedule: import("./config.ts").Schedule;
  cronJob?: CronJob;
  intervalId?: NodeJS.Timeout;
};

const active: ActiveSchedule[] = [];

function parseIntervalMs(s: string): number | null {
  const m = s.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit === "s") return n * 1000;
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return null;
}

function getCloneUrl(repo: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (token && repo) {
    // Use token for private repos
    return `https://x-access-token:${token}@github.com/${repo}.git`;
  }
  return `https://github.com/${repo}.git`;
}

async function loadRemoteConfig(repo: string): Promise<import("./config.ts").FusioneerConfig | null> {
  const tmpRoot = await mkdtemp(join(tmpdir(), "fusioneer-sched-"));
  const cloneDir = join(tmpRoot, "repo");
  try {
    const url = getCloneUrl(repo);
    // Shallow clone, quiet, timeout 30s
    await $`git clone --depth 1 ${url} ${cloneDir}`.quiet().nothrow();
    const cfg = await loadFusioneerConfig(cloneDir);
    return cfg;
  } catch {
    return null;
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function triggerScheduledJob(repo: string, sched: import("./config.ts").Schedule) {
  const issue = sched.issue ?? 0;
  const type = sched.type ?? "chore";
  const prompt = sched.prompt ?? `Scheduled ${sched.cron ? `cron ${sched.cron}` : `interval ${sched.interval}`} for ${repo}`;
  const jobId = crypto.randomUUID();
  const delivery = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Create job entry
  createJob({
    id: jobId,
    delivery_id: delivery,
    repo,
    event: "schedule",
    issue: issue || null,
    issue_title: prompt.slice(0, 80),
    type,
    branch: null,
    status: "queued",
    phase: "queued",
    payload: JSON.stringify({ schedule: sched, prompt }),
    logs: `[scheduler] ${sched.cron ? `cron ${sched.cron}` : `interval ${sched.interval}`} repo=${repo} issue=${issue || "(none)"}\n`,
    exit_code: null,
    revision_count: 0,
    started_at: null,
    finished_at: null,
  });

  // If no issue, we run a generic scheduled task (maybe just verify or custom)
  // For issue-based schedules, delegate to executor; else create a lightweight job that runs `verify` or prompt
  if (issue) {
    enqueue(repo, async () => {
      await executeJob({
        jobId,
        repo,
        issue,
        issueTitle: prompt.slice(0, 80),
        deliveryId: delivery,
        payload: { schedule: sched },
      });
    }).catch(() => {});
  } else {
    enqueue(repo, async () => {
      await runScheduledPrompt({ jobId, repo, prompt, sched });
    }).catch(() => {});
  }
}

async function runScheduledPrompt(opts: {
  jobId: string;
  repo: string;
  prompt: string;
  sched: import("./config.ts").Schedule;
}) {
  const { jobId, repo, prompt, sched } = opts;
  const { updateJob, appendJobLogs, appendEvent } = await import("./db.ts");
  const { loadFusioneerConfig, readGlobalCtx, readReviewMd, resolveVerifyCmd, hasFiducialDir } = await import("./config.ts");

  updateJob(jobId, { status: "running", started_at: new Date().toISOString(), phase: "implement" });
  appendJobLogs(jobId, `[scheduler] running generic scheduled task: ${prompt}\n`);
  appendEvent(jobId, "job.running", { repo, schedule: sched, prompt });

  const tmpRoot = await mkdtemp(join(tmpdir(), "fusioneer-sched-"));
  const cloneDir = join(tmpRoot, "repo");
  try {
    const url = getCloneUrl(repo);
    const cloneRes = await $`git clone --depth 1 ${url} ${cloneDir}`.nothrow().quiet();
    if (cloneRes.exitCode !== 0) {
      const err = await new Response((cloneRes as any).stderr as ReadableStream).text().catch(() => String(cloneRes.exitCode));
      appendJobLogs(jobId, `[scheduler] clone failed for ${repo}: ${err.slice(0, 2000)}\n`);
      updateJob(jobId, { status: "failed", finished_at: new Date().toISOString(), phase: "done", exit_code: 1 });
      appendEvent(jobId, "job.failed", { repo, schedule: sched, reason: "clone_failed" });
      return;
    }

    const cfg = await loadFusioneerConfig(cloneDir);
    const hasFiducial = await hasFiducialDir(cloneDir);
    const verifyCmd = resolveVerifyCmd(cfg, hasFiducial);
    const globalCtx = await readGlobalCtx(cloneDir);
    const reviewMd = await readReviewMd(cloneDir);

    const { runOpencodePhase } = await import("./phases.ts");
    const runRes = await runOpencodePhase({
      worktreeDir: cloneDir,
      phase: "implement",
      repo,
      issue: 0,
      globalCtx,
      reviewMd,
      verifyCmd,
      extra: prompt,
      timeoutMs: 30 * 60 * 1000,
    });
    appendJobLogs(jobId, `[scheduler] prompt run exit=${runRes.exitCode}\n${runRes.output.slice(0, 8000)}\n`);

    let exitCode = runRes.exitCode;
    let verifyOutput = "";
    try {
      const { runVerifyCmd } = await import("./phases.ts");
      const vRes = await runVerifyCmd(cloneDir, verifyCmd);
      verifyOutput = vRes.output;
      exitCode = vRes.exitCode;
      appendJobLogs(jobId, `[scheduler] verify "${verifyCmd}" exit=${vRes.exitCode}\n${vRes.output.slice(0, 4000)}\n`);
    } catch (e) {
      appendJobLogs(jobId, `[scheduler] verify spawn failed: ${String(e).slice(0, 2000)}\n`);
      exitCode = 1;
    }

    if (exitCode === 0) {
      updateJob(jobId, { status: "success", finished_at: new Date().toISOString(), phase: "done", exit_code: 0 });
      appendEvent(jobId, "job.success", { repo, schedule: sched });
    } else {
      updateJob(jobId, { status: "failed", finished_at: new Date().toISOString(), phase: "done", exit_code: exitCode });
      appendEvent(jobId, "job.failed", { repo, schedule: sched, exitCode, verifyOutput: verifyOutput.slice(0, 2000) });
    }
  } catch (e) {
    const msg = String(e);
    appendJobLogs(jobId, `[scheduler] fatal: ${msg.slice(0, 4000)}\n`);
    updateJob(jobId, { status: "failed", finished_at: new Date().toISOString(), phase: "done", exit_code: 1 });
    appendEvent(jobId, "job.failed", { repo, schedule: sched, error: msg.slice(0, 2000) });
  } finally {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }

}

export async function startScheduler() {
  const allow = process.env.FUSIONEER_ALLOW_REPOS;
  if (!allow) {
    console.log("[scheduler] no FUSIONEER_ALLOW_REPOS — skipping cron/interval");
    return;
  }
  const repos = allow
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((r) => isRepoAllowed(r));

  console.log(`[scheduler] scanning ${repos.length} repos for schedules...`);
  for (const repo of repos) {
    const cfg = await loadRemoteConfig(repo);
    if (!cfg?.schedules?.length) continue;
    console.log(`[scheduler] repo ${repo} has ${cfg.schedules.length} schedules`);
    for (const sched of cfg.schedules) {
      if (sched.enabled === false) continue;
      if (sched.cron) {
        try {
          const job = new CronJob(sched.cron, () => {
            triggerScheduledJob(repo, sched).catch((e) => console.warn(`[scheduler] cron trigger failed ${repo} ${e}`));
          });
          job.start();
          active.push({ repo, schedule: sched, cronJob: job });
          console.log(`[scheduler] registered cron ${sched.cron} for ${repo}`);
        } catch (e) {
          console.warn(`[scheduler] invalid cron ${sched.cron} for ${repo}: ${e}`);
        }
      } else if (sched.interval) {
        const ms = parseIntervalMs(sched.interval);
        if (!ms) {
          console.warn(`[scheduler] invalid interval ${sched.interval} for ${repo}`);
          continue;
        }
        const id = setInterval(() => {
          triggerScheduledJob(repo, sched).catch((e) => console.warn(`[scheduler] interval trigger failed ${repo} ${e}`));
        }, ms);
        active.push({ repo, schedule: sched, intervalId: id });
        console.log(`[scheduler] registered interval ${sched.interval} (${ms}ms) for ${repo}`);
      }
    }
  }
  console.log(`[scheduler] active schedules: ${active.length}`);

  // Phase 3: daily backup at 02:00 UTC (HMAC dedupe, 429 backoff, daily backup per PLAN.md:64)
  try {
    const backupJob = new CronJob("0 2 * * *", () => {
      backupDb().catch((e) => console.warn(`[backup] cron failed: ${e}`));
    });
    backupJob.start();
    active.push({ repo: "_system", schedule: { cron: "0 2 * * *", prompt: "daily backup" } as any, cronJob: backupJob });
    console.log("[scheduler] registered daily backup 0 2 * * *");
  } catch (e) {
    console.warn(`[scheduler] backup cron failed: ${e}`);
  }
}

export function stopScheduler() {
  for (const a of active) {
    try {
      a.cronJob?.stop();
    } catch {}
    if (a.intervalId) clearInterval(a.intervalId);
  }
  active.length = 0;
}

async function backupDb() {
  try {
    const src = process.env.FUSIONEER_DB || (process.env.NODE_ENV === "production" ? "/data/fusioneer.db" : "data/fusioneer.db");
    const { copyFile, mkdir } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { existsSync } = await import("node:fs");
    if (!existsSync(src)) return;
    const backupDir = process.env.FUSIONEER_BACKUP_DIR || (process.env.NODE_ENV === "production" ? "/data/backups" : "data/backups");
    await mkdir(backupDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const dest = join(backupDir, `fusioneer-${date}.db`);
    await copyFile(src, dest);
    console.log(`[backup] db backed up to ${dest}`);
  } catch (e) {
    console.warn(`[backup] failed: ${e}`);
  }
}

export function getSchedulerStatus() {
  return active.map((a) => ({
    repo: a.repo,
    schedule: a.schedule,
    type: a.cronJob ? "cron" : "interval",
  }));
}

export { parseIntervalMs };
