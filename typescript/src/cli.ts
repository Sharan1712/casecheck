#!/usr/bin/env node
/** casecheck command line (TypeScript edition). Same flags and exit codes as the Python edition. */
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compare, type Diff } from "./compare.ts";
import { printRun, renderHtml } from "./report.ts";
import { type RunRecord, runSuite } from "./runner.ts";
import { loadSuite, SuiteError } from "./suite.ts";
import { VERSION } from "./version.ts";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const USAGE = `usage: casecheck <command> [options]

commands:
  run SUITE      run a suite of cases against your agent
    --out-dir DIR        where run files are saved (default: .casecheck/runs)
    --html PATH          also write a single-file HTML report
    --baseline RUN       compare with a previous run file, or \`last\`
    --fail-under RATE    exit 1 if the pass rate is below RATE (0-1)
    --no-regressions     exit 1 if any case that passed in the baseline fails
    --workers N          cases run in parallel (default: 4)
    --only ID...         run only these case ids (comma-separated or repeated)
    --tag TAG...         run only cases with these tags
    --judge-model MODEL  model for judge checks (default: claude-opus-5-5)
    --no-judge           skip judge checks (no API calls)
  compare BASELINE CURRENT [--json]
  report RUN [-o PATH] [--baseline RUN]
`;

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "suite";

function loadRun(path: string): RunRecord {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err: any) {
    throw new SuiteError(`cannot read run file ${path}: ${err?.message ?? err}`);
  }
}

function previousRun(outDir: string, suiteSlug: string): string | undefined {
  let files: string[] = [];
  try {
    files = readdirSync(outDir).filter((f) => f.startsWith(`${suiteSlug}-`) && f.endsWith(".json"));
  } catch {
    return undefined;
  }
  const last = files.sort().at(-1);
  return last ? join(outDir, last) : undefined;
}

const stamp = (d = new Date()): string => {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
};

const list = (values?: string[]): string[] | undefined =>
  values?.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);

async function cmdRun(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "out-dir": { type: "string", default: ".casecheck/runs" },
      html: { type: "string" },
      baseline: { type: "string" },
      "fail-under": { type: "string" },
      "no-regressions": { type: "boolean", default: false },
      workers: { type: "string", default: "4" },
      only: { type: "string", multiple: true },
      tag: { type: "string", multiple: true },
      "judge-model": { type: "string" },
      "no-judge": { type: "boolean", default: false },
    },
  });
  const suitePath = positionals[0];
  if (!suitePath) throw new SuiteError("run needs a suite file: casecheck run cases.yaml");
  const suite = loadSuite(suitePath);
  const outDir = values["out-dir"]!;
  const suiteSlug = slug(suite.name);

  let baselinePath: string | undefined;
  if (values.baseline === "last") {
    baselinePath = previousRun(outDir, suiteSlug);
    if (!baselinePath) console.error("casecheck: no previous run to compare with yet; this run becomes the baseline.");
  } else if (values.baseline) {
    baselinePath = values.baseline;
  }

  const failUnder = values["fail-under"] !== undefined ? Number(values["fail-under"]) : undefined;
  const run = await runSuite(suite, {
    workers: Number(values.workers),
    only: list(values.only),
    tags: list(values.tag),
    judgeModel: values["judge-model"],
    skipJudge: values["no-judge"],
  });
  if (run.cases.length === 0) {
    console.error("casecheck: no cases matched --only/--tag");
    return EXIT_USAGE;
  }

  const diff: Diff | null = baselinePath ? compare(loadRun(baselinePath), run) : null;
  mkdirSync(outDir, { recursive: true });
  const runPath = join(outDir, `${suiteSlug}-${stamp()}.json`);
  writeFileSync(runPath, JSON.stringify(run, null, 2));

  printRun(run, diff);
  console.log(`  run saved to ${runPath}`);
  if (values.html) {
    writeFileSync(values.html, renderHtml(run, diff));
    console.log(`  report written to ${values.html}`);
  }
  console.log();

  let failing = false;
  if (failUnder !== undefined && run.summary.pass_rate < failUnder) {
    console.error(`casecheck: pass rate ${Math.round(run.summary.pass_rate * 100)}% is below ${Math.round(failUnder * 100)}%`);
    failing = true;
  }
  if (values["no-regressions"] && diff?.broken.length) {
    console.error(`casecheck: ${diff.broken.length} case(s) broke: ${diff.broken.join(", ")}`);
    failing = true;
  }
  if (failUnder === undefined && !values["no-regressions"] && run.summary.failed) failing = true;
  return failing ? EXIT_FAILED : EXIT_OK;
}

function cmdCompare(args: string[]): number {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { json: { type: "boolean", default: false } } });
  const [basePath, currentPath] = positionals;
  if (!basePath || !currentPath) throw new SuiteError("compare needs two run files");
  const current = loadRun(currentPath);
  const diff = compare(loadRun(basePath), current);
  if (values.json) console.log(JSON.stringify(diff, null, 2));
  else printRun(current, diff);
  return diff.broken.length ? EXIT_FAILED : EXIT_OK;
}

function cmdReport(args: string[]): number {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { output: { type: "string", short: "o", default: "casecheck-report.html" }, baseline: { type: "string" } },
  });
  const runPath = positionals[0];
  if (!runPath) throw new SuiteError("report needs a run file");
  const run = loadRun(runPath);
  const diff = values.baseline ? compare(loadRun(values.baseline), run) : null;
  writeFileSync(values.output!, renderHtml(run, diff));
  console.log(`report written to ${values.output}`);
  return EXIT_OK;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "run":
        return await cmdRun(rest);
      case "compare":
        return cmdCompare(rest);
      case "report":
        return cmdReport(rest);
      case "--version":
        console.log(`casecheck ${VERSION} (typescript)`);
        return EXIT_OK;
      default:
        console.log(USAGE);
        return command && command !== "--help" && command !== "-h" ? EXIT_USAGE : EXIT_OK;
    }
  } catch (err: any) {
    if (err instanceof SuiteError || err?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      console.error(`casecheck: ${err.message}`);
      return EXIT_USAGE;
    }
    throw err;
  }
}

// Run when executed directly (including through the npm bin symlink), not when imported by tests.
const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
