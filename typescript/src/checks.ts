/** Deterministic checks plus the judge check. Behaviour matches the Python edition. */
import { isDeepStrictEqual } from "node:util";
import { Ajv } from "ajv";
import { Judge } from "./judge.ts";
import type { Usage } from "./result.ts";
import { type Check, checkLabel } from "./suite.ts";

const NUMBER_RE = /-?\d+(?:[.,]\d+)?(?:[eE]-?\d+)?/;

export interface CheckResult {
  label: string;
  kind: string;
  passed: boolean;
  detail: string;
  error?: boolean;
  skipped?: boolean;
  usage?: Usage;
}

export interface CheckContext {
  caseInput: unknown;
  latencyMs: number;
  judge?: Judge;
  skipJudge?: boolean;
}

/** JSON text the way Python's json.dumps(..., sort_keys=True) writes it, so text checks agree. */
export function pyDumps(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyDumps).join(", ")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}: ${pyDumps((value as Record<string, unknown>)[k])}`).join(", ")}}`;
}

export const asText = (output: unknown): string => (typeof output === "string" ? output : pyDumps(output));
export const asJson = (output: unknown): unknown => (typeof output === "string" ? JSON.parse(output) : output);

function dig(value: any, path: string): unknown {
  for (const part of path.split(".")) {
    if (value === null || value === undefined) throw new Error(`KeyError: '${part}'`);
    const next = Array.isArray(value) ? value[Number(part)] : value[part];
    if (next === undefined) throw new Error(`KeyError: '${part}'`);
    value = next;
  }
  return value;
}

function toNumber(output: unknown, path?: string): number {
  if (path) {
    const n = Number(dig(asJson(output), path));
    if (Number.isNaN(n)) throw new Error(`ValueError: value at '${path}' is not a number`);
    return n;
  }
  if (typeof output === "number") return output;
  const match = NUMBER_RE.exec(asText(output));
  if (!match) throw new Error("ValueError: no number in the output");
  return Number(match[0].replace(",", "."));
}

const fmt = (n: number): string => String(Number(n.toPrecision(6)));

/**
 * Suites use Python regex syntax so one file works in both editions. Translate what JavaScript
 * spells differently: leading inline flags like (?i), and named groups (?P<name>...) / (?P=name).
 */
export function pythonRegex(pattern: string): RegExp {
  let flags = "";
  let body = pattern;
  const inline = /^\(\?([aiLmsux]+)\)/.exec(body);
  if (inline) {
    body = body.slice(inline[0].length);
    for (const f of inline[1]!) {
      if (f === "i" || f === "m" || f === "s") flags += f;
      else if (f === "u" || f === "a" || f === "L") continue; // unicode/ascii/locale: no JS equivalent needed
      else throw new Error(`regex flag (?${f}) is not supported in the TypeScript edition`);
    }
  }
  body = body.replace(/\(\?P<(\w+)>/g, "(?<$1>").replace(/\(\?P=(\w+)\)/g, "\\k<$1>");
  return new RegExp(body, flags);
}

const ajv = new Ajv({ strict: false, allErrors: false });

export async function runCheck(check: Check, output: unknown, ctx: CheckContext): Promise<CheckResult> {
  const label = checkLabel(check);
  const { kind, arg } = check;
  const ok = (passed: boolean, detail = ""): CheckResult => ({ label, kind, passed, detail });

  try {
    switch (kind) {
      case "equals": {
        if (typeof arg === "string") {
          const actual = asText(output).trim();
          return ok(actual === arg.trim(), actual === arg.trim() ? "" : `got ${JSON.stringify(actual.slice(0, 120))}`);
        }
        const actual = asJson(output);
        const same = isDeepStrictEqual(actual, arg);
        return ok(same, same ? "" : `got ${JSON.stringify(actual).slice(0, 120)}`);
      }
      case "contains":
      case "not_contains": {
        const needles = (Array.isArray(arg) ? arg : [arg]).map(String);
        const text = asText(output).toLowerCase();
        const hits = needles.filter((n) => text.includes(n.toLowerCase()));
        if (kind === "contains") {
          const missing = needles.filter((n) => !hits.includes(n));
          return ok(missing.length === 0, missing.length ? `missing ${missing.map((m) => `'${m}'`).join(", ")}` : "");
        }
        return ok(hits.length === 0, hits.length ? `found ${hits.map((h) => `'${h}'`).join(", ")}` : "");
      }
      case "regex": {
        const hit = pythonRegex(arg).test(asText(output));
        return ok(hit, hit ? "" : `no match for /${arg}/`);
      }
      case "json_schema": {
        let value: unknown;
        try {
          value = asJson(output);
        } catch {
          return ok(false, "output is not valid JSON");
        }
        const validate = ajv.compile(arg);
        if (validate(value)) return ok(true);
        const first = validate.errors?.[0];
        const where = first?.instancePath ? first.instancePath.slice(1) : "(root)";
        return ok(false, `${where}: ${first?.message ?? "does not match"}`);
      }
      case "number": {
        const expected = Number(arg.equals);
        const tolerance = Number(arg.tolerance ?? 0);
        const actual = toNumber(output, arg.path);
        const within = Math.abs(actual - expected) <= tolerance + 1e-12;
        return ok(within, within ? "" : `got ${fmt(actual)}, expected ${fmt(expected)} ± ${fmt(tolerance)}`);
      }
      case "max_latency_ms": {
        const within = ctx.latencyMs <= Number(arg);
        return ok(within, within ? "" : `took ${Math.round(ctx.latencyMs)} ms`);
      }
      case "judge": {
        if (ctx.skipJudge) return { label, kind, passed: true, detail: "skipped (--no-judge)", skipped: true };
        let judge = ctx.judge ?? new Judge();
        if (typeof arg === "object" && (arg.model || arg.effort)) {
          judge = new Judge({ model: arg.model ?? judge.model, effort: arg.effort ?? judge.effort });
        }
        const rubric = typeof arg === "string" ? arg : arg.rubric;
        const verdict = await judge.grade(rubric, ctx.caseInput, output);
        const res: CheckResult = { label, kind, passed: verdict.passed, detail: verdict.reason };
        if (verdict.error) res.error = true;
        if (verdict.usage) res.usage = verdict.usage;
        return res;
      }
    }
  } catch (err: any) {
    // A malformed output must fail the check, not crash the run.
    const message = String(err?.message ?? err);
    const detail = /^\w+Error: /.test(message) ? message : `${err?.name ?? "Error"}: ${message}`;
    return { label, kind, passed: false, detail, error: true };
  }
}
