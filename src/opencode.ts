/**
 * opencode.ts — structured output wrapper around `opencode run`
 * Provides `createOpencode()`-like API with Zod validation, per Phase 4.
 * Falls back to CLI `opencode run --format json` and extracts JSON blocks.
 */

import { z } from "zod";

// Zod schemas per PLAN.md pipeline
export const TriageSchema = z.object({
  decision: z.enum(["in_scope", "out_of_scope"]),
  reason: z.string().min(1),
  labels: z.array(z.string()).default([]),
  severity: z.enum(["low", "medium", "high"]).optional(),
});

export const PlanSchema = z.object({
  problem: z.string().min(1),
  approach: z.string().min(1),
  files: z.array(z.string()).min(1),
  verify: z.string().min(1),
  risks: z.array(z.string()).optional(),
});

export const ImplementSchema = z.object({
  filesChanged: z.array(z.string()),
  summary: z.string().min(1),
});

export const VerifySchema = z.object({
  exitCode: z.number().int(),
  logs: z.string(),
  passed: z.boolean(),
});

export type Phase = "triage" | "plan" | "implement" | "verify" | "pr";

const phaseSchemas: Record<Phase, z.ZodTypeAny> = {
  triage: TriageSchema,
  plan: PlanSchema,
  implement: ImplementSchema,
  verify: VerifySchema,
  pr: z.object({ branch: z.string(), prUrl: z.string().nullable() }),
};

export type StructuredResult<T> = {
  phase: Phase;
  data: T;
  raw: string;
  exitCode: number;
};

function extractJsonBlock(text: string): string | null {
  // Try to find last JSON object in output
  const trimmed = text.trim();
  // Direct JSON
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {}
  // Code block ```json
  const codeBlock = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlock?.[1]) {
    try {
      JSON.parse(codeBlock[1]!);
      return codeBlock[1]!;
    } catch {}
  }
  // Find outermost { ... }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = trimmed.slice(first, last + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

export async function runStructured<T>(
  opts: {
    worktreeDir: string;
    phase: Phase;
    prompt: string;
    model?: string;
    timeoutMs?: number;
    schema?: z.ZodType<T>;
  },
): Promise<StructuredResult<T>> {
  const schema = (opts.schema ?? phaseSchemas[opts.phase]) as z.ZodType<T>;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;

  // Build structured prompt suffix
  const schemaJson = JSON.stringify(z.toJSONSchema ? z.toJSONSchema(schema as any) : { type: "object" }, null, 2);
  const structuredPrompt = `${opts.prompt}\n\n---\n\nReturn ONLY valid JSON matching this schema (no markdown, no extra text):\n${schemaJson}`;

  const modelArgs = opts.model ? ["--model", opts.model] : [];
  const proc = Bun.spawn(
    ["opencode", "run", "--agent", "issue-tackle", "--format", "json", "--dir", opts.worktreeDir, ...modelArgs, structuredPrompt],
    { cwd: opts.worktreeDir, stdout: "pipe", stderr: "pipe" },
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

  const raw = [stdout, stderr].filter(Boolean).join("\n");
  const jsonStr = extractJsonBlock(raw);
  if (!jsonStr) {
    throw new Error(`structured: no JSON block found in output (exit=${exitCode}) raw=${raw.slice(0, 2000)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`structured: JSON parse failed: ${String(e)} raw=${jsonStr.slice(0, 1000)}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`structured: schema validation failed for ${opts.phase}: ${result.error.message} data=${JSON.stringify(parsed).slice(0, 2000)}`);
  }
  return { phase: opts.phase, data: result.data, raw, exitCode };
}

/**
 * createOpencode() — factory per PLAN.md Phase 4
 * Usage:
 *   const oc = createOpencode({ worktreeDir, model })
 *   const triage = await oc.run("triage", prompt, TriageSchema)
 */
export function createOpencode(defaults: { worktreeDir: string; model?: string; timeoutMs?: number } = { worktreeDir: process.cwd() }) {
  return {
    async run<T>(phase: Phase, prompt: string, schema?: z.ZodType<T>, opts?: Partial<typeof defaults>): Promise<StructuredResult<T>> {
      const worktreeDir = opts?.worktreeDir ?? defaults.worktreeDir;
      const model = opts?.model ?? defaults.model;
      const timeoutMs = opts?.timeoutMs ?? defaults.timeoutMs;
      return runStructured<T>({ worktreeDir, phase, prompt, model, timeoutMs, schema });
    },
    TriageSchema,
    PlanSchema,
    ImplementSchema,
    VerifySchema,
    schemas: phaseSchemas,
  };
}
