/**
 * policy-guard.ts — hardening: deny dangerous operations before executor runs.
 * Mirrors opencode.json permission deny but also checks in supervisor.
 */

const DENY_PATTERNS: RegExp[] = [
  /gh\s+pr\s+merge/i, // never auto-merge
  /rm\s+-rf\s+(\/\*|\*)/i,
  /rm\s+-rf\s+\//,
];

const DENY_FILES: RegExp[] = [
  /\.env(\.|$)/, // .env, .env.*, but allow .env.example
];

export function isAllowedCommand(cmd: string): boolean {
  if (!cmd) return true;
  // Block merges
  for (const re of DENY_PATTERNS) if (re.test(cmd)) return false;
  return true;
}

export function isAllowedFile(path: string): boolean {
  if (path === ".env.example") return true;
  if (path.endsWith(".env")) return false;
  for (const re of DENY_FILES) if (re.test(path)) return false;
  return true;
}

export function assertPolicy(repo: string, verifyCmd: string) {
  if (!isAllowedCommand(verifyCmd)) {
    throw new Error(`policy-guard: verifyCmd denied: ${verifyCmd}`);
  }
}

const ALLOW_REPOS_CACHE = new Map<string, boolean>();

export function isRepoAllowed(repo: string): boolean {
  const allow = process.env.FUSIONEER_ALLOW_REPOS;
  if (!allow) return true; // no allowlist = allow all (dev)
  const list = allow
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const key = repo.toLowerCase();
  if (ALLOW_REPOS_CACHE.has(key)) return ALLOW_REPOS_CACHE.get(key)!;
  const ok = list.includes(key);
  ALLOW_REPOS_CACHE.set(key, ok);
  return ok;
}

export function checkLabelGate(payload: unknown, cfgLabels?: { auto?: string }): { allowed: boolean; reason?: string } {
  // For issues labeled events, caller checks label name
  return { allowed: true };
}

/**
 * Validate revision trigger and maxRevisions gate.
 * Returns true if revision allowed.
 */
export function isRevisionAllowed(body: string, triggers: string[], currentCount: number, max: number): boolean {
  if (currentCount >= max) return false;
  const lower = body.toLowerCase();
  return triggers.some((t) => lower.includes(t.toLowerCase()));
}
