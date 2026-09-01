import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

export type WorktreeHandle = {
  tmpRoot: string;
  cloneDir: string;
  worktreeDir: string;
  branch: string;
  cleanup: () => Promise<void>;
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function branchName(type: string, issue: number, slug: string): string {
  return `fusioneer/${type}-${issue}-${slugify(slug) || "issue"}`;
}

export async function createWorktree(opts: {
  repo: string; // "owner/name"
  issue: number;
  issueTitle: string;
  type?: string;
}): Promise<WorktreeHandle> {
  const type = opts.type ?? "feat";
  const branch = branchName(type, opts.issue, opts.issueTitle);
  const tmpRoot = await mkdtemp(join(tmpdir(), "fusioneer-"));
  const cloneDir = join(tmpRoot, "repo");
  const worktreeDir = join(tmpRoot, "wt");

  const token = process.env.GITHUB_TOKEN;
  const repoUrl = token ? `https://x-access-token:${token}@github.com/${opts.repo}.git` : `https://github.com/${opts.repo}.git`;

  // Shallow clone default branch
  await $`git clone --depth 1 ${repoUrl} ${cloneDir}`.quiet();

  // Create worktree on new branch
  await $`git -C ${cloneDir} worktree add -b ${branch} ${worktreeDir}`.quiet();

  const cleanup = async () => {
    try {
      await $`git -C ${cloneDir} worktree remove --force ${worktreeDir}`.quiet();
    } catch {}
    await rm(tmpRoot, { recursive: true, force: true });
  };

  return { tmpRoot, cloneDir, worktreeDir, branch, cleanup };
}
