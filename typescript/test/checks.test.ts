import assert from "node:assert/strict";
import { test } from "node:test";
import { pyDumps, pythonRegex, runCheck } from "../src/checks.ts";
import type { Check } from "../src/suite.ts";

const ctx = (latencyMs = 10) => ({ caseInput: "x", latencyMs, skipJudge: true });
const check = (kind: Check["kind"], arg: unknown): Check => ({ kind, arg });

const cases: Array<[Check["kind"], unknown, unknown, boolean]> = [
  ["equals", "hello", " hello ", true],
  ["equals", "hello", "hello!", false],
  ["equals", { a: 1 }, { a: 1 }, true],
  ["equals", { a: 1 }, '{"a": 2}', false],
  ["contains", "Paris", "The capital is paris.", true],
  ["contains", ["Paris", "France"], "Paris", false],
  ["not_contains", "error", "all good", true],
  ["not_contains", ["error", "sorry"], "Sorry about that", false],
  ["regex", String.raw`\d{4}-\d{2}-\d{2}`, "due 2026-10-06", true],
  ["regex", String.raw`^\d+$`, "12a", false],
  ["regex", "(?i)CAN'T TELL", "Sorry, I can't tell", true],
  ["number", { equals: 6.21, tolerance: 0.01 }, "about 6.214 miles", true],
  ["number", { equals: 100, tolerance: 0.1 }, { value: 158.2 }, false],
  ["number", { path: "value", equals: 100, tolerance: 0.1 }, { value: 100.04 }, true],
  ["number", { path: "items.1", equals: 3 }, '{"items": [1, 3]}', true],
  ["number", { equals: 1, tolerance: 0.001 }, "1,0005", true],
];

for (const [kind, arg, output, passed] of cases) {
  test(`${kind} ${JSON.stringify(arg)} on ${JSON.stringify(output)} -> ${passed}`, async () => {
    const r = await runCheck(check(kind, arg), output, ctx());
    assert.equal(r.passed, passed, r.detail);
    assert.ok(!r.error, r.detail);
  });
}

test("failure details are specific", async () => {
  assert.match((await runCheck(check("contains", ["Paris", "France"]), "Paris", ctx())).detail, /missing 'France'/);
  assert.match((await runCheck(check("number", { path: "v", equals: 100 }), { v: 158.2 }, ctx())).detail, /got 158\.2/);
});

test("json_schema", async () => {
  const schema = { type: "object", required: ["value"], properties: { value: { type: "number" } } };
  assert.ok((await runCheck(check("json_schema", schema), { value: 1.5 }, ctx())).passed);
  const bad = await runCheck(check("json_schema", schema), { value: "1.5" }, ctx());
  assert.ok(!bad.passed && bad.detail.includes("value"));
  const notJson = await runCheck(check("json_schema", schema), "not json", ctx());
  assert.ok(!notJson.passed && notJson.detail.includes("not valid JSON"));
});

test("latency", async () => {
  assert.ok((await runCheck(check("max_latency_ms", 100), "x", ctx(50))).passed);
  assert.ok(!(await runCheck(check("max_latency_ms", 100), "x", ctx(150))).passed);
});

test("a malformed output fails the check instead of crashing", async () => {
  const r = await runCheck(check("number", { path: "missing", equals: 1 }), { value: 1 }, ctx());
  assert.ok(!r.passed && r.error && r.detail.includes("KeyError"));
});

test("judge can be skipped", async () => {
  const r = await runCheck(check("judge", "says hello"), "hello", ctx());
  assert.ok(r.passed && r.skipped);
});

test("python regex syntax is translated", () => {
  assert.ok(pythonRegex("(?i)hello").test("HELLO"));
  assert.equal(pythonRegex("(?P<year>\\d{4})-(?P=year)").exec("2026-2026")?.groups?.year, "2026");
  assert.throws(() => pythonRegex("(?x)a b"), /not supported/);
});

test("structured output is rendered like Python's json.dumps(sort_keys=True)", () => {
  assert.equal(pyDumps({ b: 1, a: [true, null, "x"] }), '{"a": [true, null, "x"], "b": 1}');
});

test("labels quote strings the way Python's repr() does", async () => {
  const { checkLabel } = await import("../src/suite.ts");
  assert.equal(checkLabel({ kind: "contains", arg: "can't convert" }), `contains "can't convert"`);
  assert.equal(checkLabel({ kind: "contains", arg: "plain" }), "contains 'plain'");
  assert.equal(checkLabel({ kind: "contains", arg: `both ' and "` }), `contains 'both \\' and "'`);
});
