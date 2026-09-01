// @ts-ignore - p-queue types resolved via bundler
import PQueue from "p-queue";

export type JobTask = () => Promise<void>;

// Global queue: maxParallel 2 per PLAN.md:23
const globalQueue = new PQueue({ concurrency: 2 });

// Per-repo queues: at most 1 running per repo
const perRepoQueues = new Map<string, PQueue>();
const runningRepos = new Set<string>();

function getRepoQueue(repo: string): PQueue {
  let q = perRepoQueues.get(repo);
  if (!q) {
    q = new PQueue({ concurrency: 1 });
    perRepoQueues.set(repo, q);
  }
  return q;
}

/**
 * Enqueue a job with per-repo serialization and global limit.
 * Ensures at most 1 running per repo and 2 globally.
 */
export async function enqueue(repo: string, task: JobTask): Promise<void> {
  const repoQueue = getRepoQueue(repo);
  // Wrap task to respect global concurrency
  const wrapped: JobTask = () =>
    globalQueue.add(async () => {
      if (runningRepos.has(repo)) {
        // Shouldn't happen due to repo queue, but wait
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (!runningRepos.has(repo)) {
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
      }
      runningRepos.add(repo);
      try {
        await task();
      } finally {
        runningRepos.delete(repo);
      }
    });

  return repoQueue.add(wrapped);
}

export function getQueueStats() {
  return {
    global: { pending: globalQueue.pending, size: globalQueue.size, concurrency: globalQueue.concurrency },
    perRepo: Array.from(perRepoQueues.entries()).map(([repo, q]) => ({
      repo,
      pending: q.pending,
      size: q.size,
    })),
    runningRepos: Array.from(runningRepos),
  };
}

export async function onIdle(): Promise<void> {
  const repos = Array.from(perRepoQueues.values());
  await Promise.all([globalQueue.onIdle(), ...repos.map((q) => q.onIdle())]);
}
