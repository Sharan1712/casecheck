/** Running a suite: call the agent for every case, then run its checks. */
import { performance } from "node:perf_hooks";
import { type CheckResult, runCheck } from "./checks.ts";
import { Judge } from "./judge.ts";
import type { Usage } from "./result.ts";
import type { Case, Suite } from "./suite.ts";
import { buildTarget, type Target } from "./targets.ts";
import { VERSION } from "./version.ts";

export interface CaseRecord {
  id: string;
  input: unknown;
  tags: string[];
  output: unknown;
  passed: boolean;
  latency_ms: number;
  checks: Array<Omit<CheckResult, "usage"> & { usage?: Usage }>;
  error?: string;
  usage?: Usage;
  tool_calls?: unknown[];
  meta?: Record<string, unknown>;
  judge_usage?: Usage;
  check_errors?: boolean;
}

export interface RunRecord {
  casecheck_version: string;
  edition: "typescript";
  suite: string;
  suite_path: string;
  target: string;
  judge_model: string | null;
  started_at: string;
  duration_ms: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    pass_rate: number;
    agent_tokens: Usage;
    judge_tokens: Usage;
  };
  cases: CaseRecord[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function addUsage(total: Usage, usage?: Usage): void {
  if (!usage || Object.keys(usage).length === 0) return;
  total.input_tokens = (total.input_tokens ?? 0) + Number(usage.input_tokens ?? 0);
  total.output_tokens = (total.output_tokens ?? 0) + Number(usage.output_tokens ?? 0);
}

/** A check's own fields in the same order as the Python edition's to_dict(). */
function checkRecord(r: CheckResult): CaseRecord["checks"][number] {
  const out: CaseRecord["checks"][number] = { label: r.label, kind: r.kind, passed: r.passed, detail: r.detail };
  if (r.error) out.error = true;
  if (r.skipped) out.skipped = true;
  if (r.usage && Object.keys(r.usage).length) out.usage = r.usage;
  return out;
}

export async function runCase(c: Case, target: Target, judge: Judge, skipJudge: boolean): Promise<CaseRecord> {
  const started = performance.now();
  let res;
  try {
    res = await target(c.input);
  } catch (err: any) {
    return {
      id: c.id,
      input: c.input,
      tags: c.tags,
      output: null,
      passed: false,
      error: `${err?.name ?? "Error"}: ${err?.message ?? err}`,
      latency_ms: round1(performance.now() - started),
      checks: [],
    };
  }
  const latency = performance.now() - started;
  const results: CheckResult[] = [];
  for (const check of c.checks) {
    results.push(await runCheck(check, res.output, { caseInput: c.input, latencyMs: latency, judge, skipJudge }));
  }
  const judgeUsage: Usage = {};
  for (const r of results) addUsage(judgeUsage, r.usage);

  const record: CaseRecord = {
    id: c.id,
    input: c.input,
    tags: c.tags,
    output: res.output,
    passed: results.every((r) => r.passed),
    latency_ms: round1(latency),
    checks: results.map(checkRecord),
    usage: res.usage ?? {},
    tool_calls: res.tool_calls ?? [],
  };
  if (res.meta && Object.keys(res.meta).length) record.meta = res.meta;
  if (Object.keys(judgeUsage).length) record.judge_usage = judgeUsage;
  if (results.some((r) => r.error)) record.check_errors = true;
  return record;
}

export interface RunOptions {
  workers?: number;
  only?: string[];
  tags?: string[];
  judgeModel?: string;
  skipJudge?: boolean;
  judge?: Judge;
}

export async function runSuite(suite: Suite, opts: RunOptions = {}): Promise<RunRecord> {
  const { target, description } = await buildTarget(suite);
  const judge =
    opts.judge ??
    new Judge({
      ...((opts.judgeModel ?? suite.judge.model) ? { model: opts.judgeModel ?? suite.judge.model } : {}),
      ...(suite.judge.effort ? { effort: suite.judge.effort } : {}),
    });
  const skipJudge = opts.skipJudge ?? false;

  let cases = suite.cases;
  if (opts.only?.length) cases = cases.filter((c) => opts.only!.includes(c.id));
  if (opts.tags?.length) cases = cases.filter((c) => c.tags.some((t) => opts.tags!.includes(t)));

  const startedAt = new Date();
  const t0 = performance.now();
  const records: CaseRecord[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      records[i] = await runCase(cases[i]!, target, judge, skipJudge);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.workers ?? 4) }, worker));

  const passed = records.filter((r) => r.passed).length;
  const agentTokens: Usage = {};
  const judgeTokens: Usage = {};
  for (const r of records) {
    addUsage(agentTokens, r.usage);
    addUsage(judgeTokens, r.judge_usage);
  }

  return {
    casecheck_version: VERSION,
    edition: "typescript",
    suite: suite.name,
    suite_path: suite.path,
    target: description,
    judge_model: skipJudge ? null : judge.model,
    started_at: startedAt.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    duration_ms: round1(performance.now() - t0),
    summary: {
      total: records.length,
      passed,
      failed: records.length - passed,
      errors: records.filter((r) => r.error).length,
      pass_rate: records.length ? Math.round((passed / records.length) * 10000) / 10000 : 0,
      agent_tokens: agentTokens,
      judge_tokens: judgeTokens,
    },
    cases: records,
  };
}
