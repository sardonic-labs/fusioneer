/**
 * github.ts — GraphQL helpers for review threads + rate-limit backoff
 */

export async function githubFetch(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");
  // Simple 429 backoff with jitter
  let attempt = 0;
  while (true) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "fusioneer/1.0",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status === 403) {
      attempt++;
      if (attempt > 3) throw new Error(`GitHub rate limited after ${attempt} attempts`);
      const retryAfter = Number(res.headers.get("retry-after") || "1");
      const jitter = Math.random() * 1000;
      await new Promise((r) => setTimeout(r, retryAfter * 1000 + jitter));
      continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GitHub GraphQL ${res.status}: ${txt.slice(0, 2000)}`);
    }
    const data = (await res.json()) as { data?: unknown; errors?: unknown };
    if (data.errors) throw new Error(`GraphQL errors: ${JSON.stringify(data.errors).slice(0, 2000)}`);
    return data.data;
  }
}

export async function addReviewThreadReply(threadId: string, body: string): Promise<void> {
  const mutation = `
    mutation($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
        comment { id }
      }
    }
  `;
  await githubFetch(mutation, { threadId, body });
}

export async function resolveReviewThread(threadId: string): Promise<void> {
  const mutation = `
    mutation($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread { id isResolved }
      }
    }
  `;
  await githubFetch(mutation, { threadId });
}

export async function getPrReviewThreads(owner: string, repo: string, prNumber: number): Promise<unknown> {
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 50) { nodes { id isResolved comments(first:5){nodes{body}} } }
        }
      }
    }
  `;
  return githubFetch(query, { owner, repo, pr: prNumber });
}
