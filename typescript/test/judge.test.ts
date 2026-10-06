import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MODEL, Judge, VERDICT_SCHEMA } from "../src/judge.ts";
import { fakeClient } from "./helpers.ts";

test("judge passes and reports usage", async () => {
  const { client, calls } = fakeClient();
  const v = await new Judge({ client }).grade("states amount and unit", "Convert 5 kg", { text: "5 kg is 11 lb." });
  assert.ok(v.passed && !v.error);
  assert.deepEqual(v.usage, { input_tokens: 120, output_tokens: 30 });
  const call = calls[0];
  assert.equal(call.model, DEFAULT_MODEL);
  assert.deepEqual(call.output_config.format.schema, VERDICT_SCHEMA);
  assert.equal(call.output_config.effort, "low");
  assert.equal(call.fallbacks, "default");
  assert.ok(call.messages[0].content.includes("<rubric>"));
});

test("failing verdict", async () => {
  const { client } = fakeClient('{"passed": false, "reason": "no unit"}');
  const v = await new Judge({ client }).grade("r", "i", "o");
  assert.ok(!v.passed && v.reason === "no unit" && !v.error);
});

test("a refusal is an error, never a pass", async () => {
  const { client } = fakeClient("", "refusal");
  const v = await new Judge({ client }).grade("r", "i", "o");
  assert.ok(!v.passed && v.error);
});

test("an unreadable verdict is an error", async () => {
  const { client } = fakeClient("definitely passes");
  const v = await new Judge({ client }).grade("r", "i", "o");
  assert.ok(!v.passed && v.error);
});

test("model and effort can be overridden", async () => {
  const { client, calls } = fakeClient();
  await new Judge({ model: "claude-sonnet-5-5", effort: "medium", client }).grade("r", "i", "o");
  assert.equal(calls[0].model, "claude-sonnet-5-5");
  assert.equal(calls[0].output_config.effort, "medium");
});
