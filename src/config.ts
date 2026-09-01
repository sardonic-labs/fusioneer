import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Schedule = {
  cron?: string; // "0 * * * *" or "0 6 * * *"
  interval?: string; // "1h", "30m", "6h", "1d" — parsed to ms
  issue?: number; // if set, run pipeline for that issue; else run as scheduled task type
  type?: string; // "feat" | "chore" etc for branch naming
  prompt?: string; // optional prompt override for scheduled run
  enabled?: boolean; // default true
};

export type FusioneerConfig = {
  triggers?: Record<string, string[]>;
  labels?: { auto?: string };
  verify?: string;
  hardware_verify?: string;
  revision?: { triggers?: string[]; maxRevisions?: number };
  schedules?: Schedule[];
};

const DEFAULT_VERIFY = "bun run check";

export async function loadFusioneerConfig(worktreeDir: string): Promise<FusioneerConfig> {
  const candidates = [
    join(worktreeDir, ".opencode/fusioneer.json"),
    join(worktreeDir, ".opencode/fusioneer/fusioneer.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf-8");
      return JSON.parse(raw) as FusioneerConfig;
    } catch {
      // try next
    }
  }
  return { verify: DEFAULT_VERIFY };
}

export function resolveVerifyCmd(cfg: FusioneerConfig, hasFiducial: boolean): string {
  if (hasFiducial && cfg.hardware_verify) return cfg.hardware_verify;
  return cfg.verify ?? DEFAULT_VERIFY;
}

export async function hasFiducialDir(worktreeDir: string): Promise<boolean> {
  try {
    await readFile(join(worktreeDir, "fiducial/AGENTS.md"), "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function readGlobalCtx(worktreeDir: string): Promise<string> {
  try {
    return await readFile(join(worktreeDir, "GLOBAL_CTX.md"), "utf-8");
  } catch {
    return "";
  }
}

export async function readReviewMd(worktreeDir: string): Promise<string> {
  try {
    return await readFile(join(worktreeDir, ".opencode/fusioneer/REVIEW.md"), "utf-8");
  } catch {
    return "";
  }
}
