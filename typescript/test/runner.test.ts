import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compare } from "../src/compare.ts";
import { Judge } from "../src/judge.ts";
import { runSuite } from "../src/runner.ts";
import { loadSuite, SuiteError } from "../src/suite.ts";
import { EXAMPLE, fakeClient, tempDir, writeSuite } from "./helpers.ts";

test("example suite runs with one known bug", async () => {
  const run = await runSuite(loadSuite(EXAMPLE), { skipJudge: true });
  const byId = Object.fromEntries(run.cases.map((c) => [c.id, c]));
  assert.equal(byId["fahrenheit-to-celsius"]!.passed, false);
  for (const c of run.cases) if (c.id !== "fahrenheit-to-celsius") assert.ok(c.passed, c.id);
  assert.equal((byId["km-to-miles"]!.tool_calls as any[])[0].name, "convert");
  assert.equal(run.summary.total, 9);
  assert.equal(run.summary.failed, 1);
});

test("judge checks use the injected judge", async () => {
  const { client, calls } = fakeClient();
  const run = await runSuite(loadSuite(EXAMPLE), { tags: ["judge"], judge: new Judge({ client }) });
  assert.equal(run.summary.total, 1);
  assert.equal(run.summary.passed, 1);
  assert.deepEqual(run.summary.judge_tokens, { input_tokens: 120, output_tokens: 30 });
  assert.equal(calls.length, 1);
});

const invalid: Array<[string, RegExp]> = [
  ["cases: []", /target/],
  ["target: {js: a.ts:b}\ncases: []", /non-empty/],
  ["target: {js: a.ts:b}\ncases:\n  - id: x\n", /input/],
  ["target: {js: a.ts:b}\ncases:\n  - input: hi\n    checks:\n      - startswith: h\n", /unknown check/],
  ["target: {js: a.ts:b}\ncases:\n  - {id: a, input: x}\n  - {id: a, input: y}\n", /duplicate/],
  ["target: {js: a.ts:b}\ncases:\n  - input: x\n    checks:\n      - number: 3\n", /equals/],
  ["target: {python: a:b}\ncases:\n  - input: x\n", /Python edition/],
];
for (const [body, message] of invalid) {
  test(`suite validation: ${message}`, () => {
    assert.throws(() => loadSuite(writeSuite(tempDir(), body)), (err: unknown) => err instanceof SuiteError && message.test(err.message));
  });
}

test("command target with an envelope", async () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "agent.mjs"),
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({output:s.toUpperCase(),usage:{input_tokens:3,output_tokens:2}})));",
  );
  const path = writeSuite(dir, `target:\n  command: [${JSON.stringify(process.execPath)}, agent.mjs]\ncases:\n  - id: shout\n    input: hello\n    checks:\n      - equals: HELLO\n`);
  const run = await runSuite(loadSuite(path));
  assert.ok(run.cases[0]!.passed, JSON.stringify(run.cases[0]));
  assert.deepEqual(run.summary.agent_tokens, { input_tokens: 3, output_tokens: 2 });
});

test("an agent exception is recorded", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "boom.mjs"), "export function agent() { throw new TypeError('bad input'); }");
  const run = await runSuite(loadSuite(writeSuite(dir, "target:\n  js: boom.mjs:agent\ncases:\n  - id: a\n    input: x\n")));
  assert.equal(run.cases[0]!.passed, false);
  assert.match(run.cases[0]!.error!, /TypeError: bad input/);
});

test("compare", () => {
  const base = { started_at: "t0", summary: { pass_rate: 0.5 }, cases: [
    { id: "a", passed: true }, { id: "b", passed: false }, { id: "c", passed: false }, { id: "gone", passed: true },
  ] };
  const cur = { summary: { pass_rate: 0.5 }, cases: [
    { id: "a", passed: false }, { id: "b", passed: true }, { id: "c", passed: false }, { id: "d", passed: true },
  ] };
  const diff = compare(base, cur);
  assert.deepEqual(diff.broken, ["a"]);
  assert.deepEqual(diff.fixed, ["b"]);
  assert.deepEqual(diff.still_failing, ["c"]);
  assert.deepEqual(diff.new, ["d"]);
  assert.deepEqual(diff.removed, ["gone"]);
});
