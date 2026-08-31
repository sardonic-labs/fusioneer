import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type FusioneerConfig = {
  triggers?: Record<string, string[]>;
  labels?: { auto?: string };
  verify?: string;
  hardware_verify?: string;
  revision?: { triggers?: string[]; maxRevisions?: number };
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
