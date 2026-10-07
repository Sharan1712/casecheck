import assert from "node:assert/strict";
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, main } from "../src/cli.ts";
import { EXAMPLE, tempDir } from "./helpers.ts";

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const write = process.stdout.write.bind(process.stdout);
  const ewrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => ((out += s), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => ((err += s), true)) as typeof process.stderr.write;
  try {
    return { code: await fn(), out, err };
  } finally {
    process.stdout.write = write;
    process.stderr.write = ewrite;
  }
}

function copyExample(): string {
  const dst = join(tempDir(), "example");
  cpSync(dirname(EXAMPLE), dst, { recursive: true });
  // The copy lives outside the repo, so point the demo agent at this checkout's casecheck.
  const agent = join(dst, "agent.ts");
  const src = join(dirname(EXAMPLE), "../../typescript/src/index.ts");
  writeFileSync(agent, readFileSync(agent, "utf8").replace("../../typescript/src/index.ts", src));
  return dst;
}

test("run, fix, and compare with the last run", async () => {
  const ex = copyExample();
  const out = join(tempDir(), "runs");
  const suite = join(ex, "cases.yaml");

  assert.equal((await capture(() => main(["run", suite, "--no-judge", "--out-dir", out]))).code, EXIT_FAILED);

  const agent = join(ex, "agent.ts");
  writeFileSync(agent, readFileSync(agent, "utf8").replace("value - (32 * 5) / 9", "((value - 32) * 5) / 9"));
  // Node caches imported modules by URL, so load the fixed agent under a new file name.
  const fixed = join(ex, "agent_fixed.ts");
  writeFileSync(fixed, readFileSync(agent, "utf8"));
  writeFileSync(suite, readFileSync(suite, "utf8").replace("js: agent.ts:agent", "js: agent_fixed.ts:agent"));

  const html = join(tempDir(), "report.html");
  const second = await capture(() =>
    main(["run", suite, "--no-judge", "--out-dir", out, "--baseline", "last", "--html", html]),
  );
  assert.equal(second.code, EXIT_OK, second.err);
  assert.match(second.out, /fixed: fahrenheit-to-celsius/);
  assert.match(second.out, /9\/9 passed/);
  assert.match(readFileSync(html, "utf8"), /fixed/);

  const runs = readdirSync(out).sort().map((f) => join(out, f));
  assert.equal(runs.length, 2);
  const cmp = await capture(async () => main(["compare", runs[0]!, runs[1]!, "--json"]));
  assert.equal(cmp.code, EXIT_OK);
  assert.deepEqual(JSON.parse(cmp.out).fixed, ["fahrenheit-to-celsius"]);
});

test("thresholds", async () => {
  const out = join(tempDir(), "runs");
  const run = (...extra: string[]) => capture(() => main(["run", EXAMPLE, "--no-judge", "--out-dir", out, ...extra]));
  assert.equal((await run("--fail-under", "0.8")).code, EXIT_OK);
  assert.equal((await run("--fail-under", "0.95")).code, EXIT_FAILED);
  assert.equal((await run("--baseline", "last", "--no-regressions")).code, EXIT_OK);
});

test("a bad suite is a usage error", async () => {
  const bad = join(tempDir(), "bad.yaml");
  writeFileSync(bad, "cases: []");
  const res = await capture(() => main(["run", bad]));
  assert.equal(res.code, EXIT_USAGE);
  assert.match(res.err, /target/);
});
