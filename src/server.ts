// @ts-ignore - hono types resolved via bundler
import { Hono, type Context } from "hono";
// @ts-ignore
import { cors } from "hono/cors";
import { createJob, getJob, getJobByDelivery, listJobs, updateJob, appendEvent, appendJobLogs } from "./db.ts";
import { enqueue, getQueueStats } from "./queue.ts";
import { executeJob } from "./executor.ts";
import { isRepoAllowed } from "./policy-guard.ts";

const app = new Hono();

// CORS for dashboard
app.use("/*", cors());

// Health
app.get("/health", (c: Context) => c.json({ ok: true, version: "0.1.0" }));

// Queue stats
app.get("/queue/stats", (c: Context) => c.json(getQueueStats()));

// List jobs
app.get("/jobs", (c: Context) => {
  const limit = Number(c.req.query("limit") || "50");
  const offset = Number(c.req.query("offset") || "0");
  const jobs = listJobs(limit, offset);
  return c.json({ jobs, limit, offset });
});

// Get job
app.get("/jobs/:id", (c: Context) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "missing id" }, 400);
  const job = getJob(id);
  if (!job) return c.json({ error: "not found" }, 404);
  return c.json(job);
});

// Logs stream (SSE) + fallback JSON
app.get("/jobs/:id/logs", (c: Context) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "missing id" }, 400);
  const job = getJob(id);
  if (!job) return c.json({ error: "not found" }, 404);

  const accept = c.req.header("accept") || "";
  if (accept.includes("text/event-stream")) {
    // SSE: stream logs
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        let lastLogs = job.logs || "";
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ logs: lastLogs })}\n\n`));

        const interval = setInterval(() => {
          const j = getJob(id);
          if (!j) {
            controller.enqueue(enc.encode(`event: done\ndata: {}\n\n`));
            clearInterval(interval);
            controller.close();
            return;
          }
          if ((j.logs || "") !== lastLogs) {
            lastLogs = j.logs || "";
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ logs: lastLogs, status: j.status, phase: j.phase })}\n\n`));
          }
          if (j.status === "success" || j.status === "failed" || j.status === "skipped") {
            controller.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ status: j.status })}\n\n`));
            clearInterval(interval);
            controller.close();
          }
        }, 1000);

        c.req.raw.signal?.addEventListener("abort", () => {
          clearInterval(interval);
          try {
            controller.close();
          } catch {}
        });
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }
  return c.json({ logs: job.logs, status: job.status, phase: job.phase });
});

// List agents (per-repo) — reads from DB distinct repos
app.get("/agents", (c: Context) => {
  const jobs = listJobs(100, 0);
  const repos = [...new Set(jobs.map((j) => j.repo))];
  return c.json({ repos, jobs: jobs.slice(0, 10) });
});

// Phase 4: scheduler status
app.get("/schedules", async (c: Context) => {
  const { getSchedulerStatus } = await import("./scheduler.ts");
  return c.json({ schedules: getSchedulerStatus() });
});

// Phase 4: structured output test (private gantry ready)
app.get("/structured/schemas", (c: Context) => {
  return c.json({
    triage: { decision: "in_scope|out_of_scope", reason: "string", labels: "string[]" },
    plan: { problem: "string", approach: "string", files: "string[]", verify: "string" },
    note: "use createOpencode().run(phase,prompt,schema) from src/opencode.ts",
  });
});

// Webhook HMAC helper
async function verifyHmac(secret: string, payload: string, signature: string | null): Promise<boolean> {
  if (!secret) return true; // no secret = allow (dev)
  if (!signature) return false;
  const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // constant time comparison
  if (hex.length !== sig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hex.length; i++) mismatch |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return mismatch === 0;
}

// Webhook receiver — POST /webhook/github
app.post("/webhook/github", async (c: Context) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") || c.req.header("X-Hub-Signature-256") || null;
  const delivery = c.req.header("x-github-delivery") || c.req.header("X-GitHub-Delivery") || c.req.header("x-github-delivery") || `manual-${Date.now()}`;
  const event = c.req.header("x-github-event") || c.req.header("X-GitHub-Event") || "unknown";

  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  if (secret) {
    const ok = await verifyHmac(secret, rawBody, signature);
    if (!ok) return c.json({ error: "invalid signature" }, 401);
  }

  // Dedupe by delivery_id
  const existing = getJobByDelivery(delivery);
  if (existing) {
    return c.json({ ok: true, deduped: true, jobId: existing.id });
  }

  // Parse payload — support both direct GitHub webhook and fusioneer.yml forwarded {repo,event,payload}
  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  // Handle forwarded payload from .github/workflows/fusioneer.yml
  // It sends {repo, event, payload: <github.event>}
  let repo: string | null = null;
  let ghEvent: any = parsed;
  let ghEventName = event;
  if (parsed.repo && parsed.payload && parsed.event) {
    repo = parsed.repo;
    ghEvent = parsed.payload;
    ghEventName = parsed.event;
  } else if (parsed.repository?.full_name) {
    repo = parsed.repository.full_name;
  }

  // Extract issue / PR context
  let issue: number | null = null;
  let issueTitle: string | null = null;
  let commentBody: string | null = null;
  let label: string | null = null;

  // Try multiple locations
  if (ghEvent.issue?.number) {
    issue = ghEvent.issue.number;
    issueTitle = ghEvent.issue.title ?? null;
  } else if (ghEvent.pull_request?.number) {
    // For PRs, treat as issue number
    issue = ghEvent.pull_request.number;
    issueTitle = ghEvent.pull_request.title ?? null;
  } else if (ghEvent.number) {
    issue = ghEvent.number;
  }

  if (ghEvent.comment?.body) commentBody = ghEvent.comment.body;
  if (ghEvent.label?.name) label = ghEvent.label.name;

  // For issue_comment, also try to find issue number
  if (!issue && ghEvent.issue?.number) issue = ghEvent.issue.number;

  // If still no repo, fail
  if (!repo) {
    return c.json({ error: "missing repo" }, 400);
  }

  // Allowlist gate
  if (!isRepoAllowed(repo)) {
    const job = createJob({
      id: crypto.randomUUID(),
      delivery_id: delivery,
      repo,
      event: ghEventName,
      issue,
      issue_title: issueTitle,
      type: null,
      branch: null,
      status: "skipped",
      phase: null,
      payload: rawBody,
      logs: `[gate] repo ${repo} not in FUSIONEER_ALLOW_REPOS\n`,
      exit_code: null,
      revision_count: 0,
      started_at: null,
      finished_at: new Date().toISOString(),
    });
    appendEvent(job.id, "gate.skipped", { reason: "allowlist", repo });
    return c.json({ ok: true, skipped: true, reason: "allowlist", jobId: job.id });
  }

  // Determine trigger: check labels and comment triggers
  // Load per-repo config would require cloning, but we can do quick gate here and defer full check to executor
  // For now, handle: if event is issues.labeled and label is fusioneer:auto => allow
  // if event is issue_comment/pull_request_review_comment and body contains /fusioneer or /revise => allow as revision
  let isRevision = false;
  let revisionBody: string | null = null;
  if (commentBody) {
    const lower = commentBody.toLowerCase();
    if (lower.includes("/fusioneer") || lower.includes("/revise")) {
      isRevision = true;
      revisionBody = commentBody;
      // Extract issue from comment's issue url if needed
      if (!issue && ghEvent.issue?.number) issue = ghEvent.issue.number;
      if (!issue && ghEvent.pull_request?.number) issue = ghEvent.pull_request.number;
    }
  }

  // Label gate: if labeled event but label not fusioneer:auto, skip unless it's a PR
  if (ghEventName === "issues" && ghEvent.action === "labeled") {
    const autoLabel = "fusioneer:auto"; // could load from config, but default
    if (label && label !== autoLabel && !isRevision) {
      const job = createJob({
        id: crypto.randomUUID(),
        delivery_id: delivery,
        repo,
        event: ghEventName,
        issue,
        issue_title: issueTitle,
        type: null,
        branch: null,
        status: "skipped",
        phase: null,
        payload: rawBody,
        logs: `[gate] label ${label} != ${autoLabel} — skipped\n`,
        exit_code: null,
        revision_count: 0,
        started_at: null,
        finished_at: new Date().toISOString(),
      });
      return c.json({ ok: true, skipped: true, reason: "label", jobId: job.id });
    }
  }

  if (!issue && !isRevision) {
    // For PR synchronize without issue, we skip or treat as PR review
    // For now, skip if no issue
    if (ghEventName === "pull_request") {
      // PR reviews are handled but need PR number
      if (ghEvent.pull_request?.number) {
        issue = ghEvent.pull_request.number;
      } else {
        return c.json({ ok: true, skipped: true, reason: "no issue/pr number" });
      }
    } else {
      return c.json({ ok: true, skipped: true, reason: "no issue number" });
    }
  }

  // Create job
  const jobId = crypto.randomUUID();
  const job = createJob({
    id: jobId,
    delivery_id: delivery,
    repo,
    event: ghEventName,
    issue,
    issue_title: issueTitle,
    type: isRevision ? "revise" : "feat",
    branch: null,
    status: "queued",
    phase: "queued",
    payload: rawBody,
    logs: `[webhook] ${ghEventName} repo=${repo} issue=${issue} label=${label ?? ""} delivery=${delivery}\n`,
    exit_code: null,
    revision_count: isRevision ? 1 : 0,
    started_at: null,
    finished_at: null,
  });

  // Enqueue execution (non-blocking)
  enqueue(repo, async () => {
    await executeJob({
      jobId,
      repo,
      issue: issue!,
      issueTitle: issueTitle ?? `issue-${issue}`,
      deliveryId: delivery,
      payload: ghEvent,
      revisionBody,
    });
  }).catch((e) => {
    // Log error to job
    const msg = String(e);
    try {
      appendJobLogs(jobId, `[queue] enqueue failed: ${msg}\n`);
      updateJob(jobId, { status: "failed", finished_at: new Date().toISOString() } as any);
    } catch {}
  });

  return c.json({ ok: true, jobId, queued: true });
});

// Catch-all 404
app.all("*", (c: Context) => c.json({ error: "not found" }, 404));

export default app;
export { app };
