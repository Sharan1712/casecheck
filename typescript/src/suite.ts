import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export const CHECK_KINDS = [
  "equals",
  "contains",
  "not_contains",
  "regex",
  "json_schema",
  "number",
  "judge",
  "max_latency_ms",
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** The suite file is malformed. The message says where. */
export class SuiteError extends Error {
  override name = "SuiteError";
}

export interface Check {
  kind: CheckKind;
  arg: any;
  name?: string;
}

export interface Case {
  id: string;
  input: unknown;
  checks: Check[];
  tags: string[];
}

export interface Suite {
  name: string;
  target: Record<string, any>;
  cases: Case[];
  path: string;
  judge: { model?: string; effort?: string };
  timeout: number;
}

const shorten = (text: string, limit: number): string => {
  const flat = String(text).split(/\s+/).filter(Boolean).join(" ");
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
};

/** Python's repr() for strings, so labels read the same in both editions. */
function repr(value: unknown): string {
  if (typeof value !== "string") return JSON.stringify(value);
  const escaped = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  if (value.includes("'") && !value.includes('"')) return `"${escaped}"`;
  return `'${escaped.replace(/'/g, "\\'")}'`;
}

export function checkLabel(check: Check): string {
  if (check.name) return check.name;
  const { kind, arg } = check;
  switch (kind) {
    case "judge":
      return `judge: ${shorten(typeof arg === "string" ? arg : (arg.rubric ?? ""), 60)}`;
    case "json_schema":
      return "matches JSON schema";
    case "number": {
      const tolerance = arg.tolerance ?? 0;
      return `${arg.path ?? "number"} ≈ ${arg.equals}${tolerance ? ` ± ${tolerance}` : ""}`;
    }
    case "max_latency_ms":
      return `latency ≤ ${arg} ms`;
    case "regex":
      return `matches /${arg}/`;
    default: {
      const verb = { contains: "contains", not_contains: "does not contain", equals: "equals" }[kind];
      if (Array.isArray(arg) && kind !== "equals") return `${verb} ${arg.map(repr).join(", ")}`;
      return `${verb} ${shorten(repr(arg), 60)}`;
    }
  }
}

const isPlainObject = (v: unknown): v is Record<string, any> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseCheck(raw: unknown, where: string): Check {
  if (!isPlainObject(raw)) throw new SuiteError(`${where}: a check must be a mapping like \`contains: "text"\``);
  const { name, ...rest } = raw;
  const keys = Object.keys(rest);
  const unknown = keys.filter((k) => !(CHECK_KINDS as readonly string[]).includes(k));
  if (unknown.length) {
    throw new SuiteError(`${where}: unknown check '${unknown[0]}'. Known checks: ${CHECK_KINDS.join(", ")}`);
  }
  if (keys.length !== 1) throw new SuiteError(`${where}: each check needs exactly one of: ${CHECK_KINDS.join(", ")}`);
  const kind = keys[0] as CheckKind;
  const arg = rest[kind];
  if (kind === "regex" && typeof arg !== "string") throw new SuiteError(`${where}: regex must be a string`);
  if (kind === "number" && !(isPlainObject(arg) && "equals" in arg)) {
    throw new SuiteError(`${where}: number needs at least \`equals:\` (and optionally \`tolerance:\`, \`path:\`)`);
  }
  if (kind === "judge" && !(typeof arg === "string" || (isPlainObject(arg) && "rubric" in arg))) {
    throw new SuiteError(`${where}: judge needs a rubric, either as text or as \`rubric:\``);
  }
  if (kind === "json_schema" && !isPlainObject(arg)) {
    throw new SuiteError(`${where}: json_schema must be a JSON Schema mapping`);
  }
  return name === undefined ? { kind, arg } : { kind, arg, name: String(name) };
}

export function loadSuite(file: string): Suite {
  const path = resolve(file);
  const fileName = basename(path);
  let data: unknown;
  try {
    data = parseYaml(readFileSync(path, "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new SuiteError(`${file}: file not found`);
    throw new SuiteError(`${file}: invalid YAML: ${err?.message ?? err}`);
  }
  if (!isPlainObject(data)) throw new SuiteError(`${file}: expected a mapping with \`target:\` and \`cases:\``);

  const target = data.target;
  if (!isPlainObject(target) || !["js", "command", "http"].some((k) => k in target)) {
    const pythonOnly = isPlainObject(target) && "python" in target;
    throw new SuiteError(
      `${file}: \`target:\` needs one of \`js:\`, \`command:\` or \`http:\`` +
        (pythonOnly ? " (this suite only has a `python:` target; run it with the Python edition)" : ""),
    );
  }

  const rawCases = data.cases;
  if (!Array.isArray(rawCases) || rawCases.length === 0) throw new SuiteError(`${file}: \`cases:\` must be a non-empty list`);

  const seen = new Set<string>();
  const cases: Case[] = rawCases.map((raw, i) => {
    const where = `${fileName}: case #${i + 1}`;
    if (!isPlainObject(raw) || !("input" in raw)) throw new SuiteError(`${where}: every case needs an \`input:\``);
    const id = String(raw.id ?? `case-${i + 1}`);
    if (seen.has(id)) throw new SuiteError(`${where}: duplicate id '${id}'`);
    seen.add(id);
    const checks = ((raw.checks ?? []) as unknown[]).map((c, j) =>
      parseCheck(c, `${fileName}: case '${id}', check #${j + 1}`),
    );
    return { id, input: raw.input, checks, tags: ((raw.tags ?? []) as unknown[]).map(String) };
  });

  const judge = data.judge ?? {};
  if (!isPlainObject(judge)) throw new SuiteError(`${file}: \`judge:\` must be a mapping (model, effort)`);

  const stem = fileName.replace(/\.[^.]+$/, "");
  return {
    name: String(data.name ?? stem),
    target,
    cases,
    path,
    judge,
    timeout: Number(data.timeout ?? 60),
  };
}
