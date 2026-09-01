import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export type JobStatus = "queued" | "running" | "success" | "failed" | "skipped";
export type JobRow = {
  id: string;
  delivery_id: string | null;
  repo: string;
  event: string;
  issue: number | null;
  issue_title: string | null;
  type: string | null;
  branch: string | null;
  status: JobStatus;
  phase: string | null;
  payload: string | null;
  logs: string | null;
  exit_code: number | null;
  revision_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

let db: Database | null = null;
let dbPath: string = "";

export function getDbPath(): string {
  // /data/fusioneer.db in docker, else ./data/fusioneer.db or ~/.local/share
  if (process.env.FUSIONEER_DB) return process.env.FUSIONEER_DB;
  if (process.env.NODE_ENV === "production") return "/data/fusioneer.db";
  return join(process.cwd(), "data", "fusioneer.db");
}

export function getDb(): Database {
  if (db) return db;
  dbPath = getDbPath();
  // ensure parent dir exists (sync)
  try {
    const { mkdirSync } = require("node:fs");
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {}
  db = new Database(dbPath, { create: true });
  // WAL mode for concurrent readers/writers
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  initSchema(db);
  return db;
}

function initSchema(d: Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      delivery_id TEXT UNIQUE,
      repo TEXT NOT NULL,
      event TEXT NOT NULL,
      issue INTEGER,
      issue_title TEXT,
      type TEXT,
      branch TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued','running','success','failed','skipped')),
      phase TEXT,
      payload TEXT,
      logs TEXT,
      exit_code INTEGER,
      revision_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_repo ON jobs(repo);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_job ON events(job_id);
  `);
}

export function createJob(row: Omit<JobRow, "created_at"> & Partial<Pick<JobRow, "created_at">>): JobRow {
  const d = getDb();
  const now = new Date().toISOString();
  const full: JobRow = { ...row } as JobRow;
  if (!full.created_at) full.created_at = now;
  if (full.logs == null) full.logs = "";
  const stmt = d.prepare(
    `INSERT INTO jobs (id, delivery_id, repo, event, issue, issue_title, type, branch, status, phase, payload, logs, exit_code, revision_count, created_at, started_at, finished_at)
     VALUES ($id,$delivery_id,$repo,$event,$issue,$issue_title,$type,$branch,$status,$phase,$payload,$logs,$exit_code,$revision_count,$created_at,$started_at,$finished_at)`
  );
  stmt.run({
    $id: full.id,
    $delivery_id: full.delivery_id,
    $repo: full.repo,
    $event: full.event,
    $issue: full.issue,
    $issue_title: full.issue_title,
    $type: full.type,
    $branch: full.branch,
    $status: full.status,
    $phase: full.phase,
    $payload: full.payload,
    $logs: full.logs,
    $exit_code: full.exit_code,
    $revision_count: full.revision_count,
    $created_at: full.created_at,
    $started_at: full.started_at,
    $finished_at: full.finished_at,
  });
  appendEvent(full.id, "job.created", { repo: full.repo, issue: full.issue, delivery_id: full.delivery_id });
  return full;
}

export function getJob(id: string): JobRow | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM jobs WHERE id=$id").get({ $id: id }) as JobRow | undefined;
  return row ?? null;
}

export function getJobByDelivery(deliveryId: string): JobRow | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM jobs WHERE delivery_id=$did").get({ $did: deliveryId }) as JobRow | undefined;
  return row ?? null;
}

export function listJobs(limit = 50, offset = 0): JobRow[] {
  const d = getDb();
  return d.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT $limit OFFSET $offset").all({ $limit: limit, $offset: offset } as any) as unknown as JobRow[];
}

export function updateJob(id: string, patch: Partial<JobRow>) {
  const d = getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: id };
  for (const [k, v] of Object.entries(patch)) {
    if (k === "id") continue;
    sets.push(`${k}=$${k}`);
    params[`$${k}`] = v;
  }
  if (sets.length === 0) return;
  d.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id=$id`).run(params as any);
}

export function appendJobLogs(id: string, chunk: string) {
  const d = getDb();
  // Use SQL concatenation to avoid race
  d.prepare("UPDATE jobs SET logs = COALESCE(logs,'') || $chunk WHERE id=$id").run({ $id: id, $chunk: chunk });
}

export function appendEvent(jobId: string | null, type: string, payload: unknown) {
  const d = getDb();
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  d.prepare("INSERT INTO events (id, job_id, type, payload, created_at) VALUES ($id,$job_id,$type,$payload,$created_at)").run({
    $id: id,
    $job_id: jobId,
    $type: type,
    $payload: JSON.stringify(payload ?? {}),
    $created_at: created_at,
  });
  // Also append to JSONL on disk
  appendEventsJsonl({ id, job_id: jobId, type, payload, created_at });
}

async function appendEventsJsonl(entry: unknown) {
  try {
    const base = process.env.FUSIONEER_EVENTS_DIR || join(homedir(), "fusioneer", "events");
    const d = new Date();
    const file = join(base, `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}.jsonl`);
    await mkdir(dirname(file), { recursive: true });
    const line = JSON.stringify(entry) + "\n";
    const { appendFile } = await import("node:fs/promises");
    await appendFile(file, line, "utf-8");
  } catch {}
}

export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {}
    db = null;
  }
}
