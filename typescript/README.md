# casebook for TypeScript

**Test cases for AI agents.** The TypeScript edition of [casebook](https://github.com/Sharan1712/casebook): write cases in YAML, run one command, and see which cases pass, why the others failed, and what your last change fixed or broke.

It reads the same suite files and writes the same run files as the Python edition, so a team can mix both and still compare runs.

```bash
npm install --save-dev @sharan1712/casebook
npm install --save-dev @anthropic-ai/sdk   # only for judge: checks
```

Node 22.18 or newer. Agents written in TypeScript run directly: Node strips the types, no build step.

## Quick start

```ts
// agent.ts
import { result } from "@sharan1712/casebook";

export async function answer(question: string) {
  const response = await client.messages.create({ /* ... */ });
  return result(response.content[0].text, {
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    meta: { prompt_version: "v7" },
  });
}
```

Return a plain value for the simple case; wrap it in `result(...)` to also record usage, tool calls and metadata in the trace.

```yaml
# cases.yaml
name: support agent
target:
  js: agent.ts:answer          # file:exportedFunction (also .js/.mjs, or package:export)

cases:
  - id: refund-window
    input: "Can I still return shoes I bought 40 days ago?"
    checks:
      - contains: "30 days"
      - judge: Says the 30-day window has passed and does not promise a refund.
```

```bash
npx casebook run cases.yaml                         # run it
npx casebook run cases.yaml --baseline last         # what did my change fix or break?
npx casebook run cases.yaml --no-judge --html report.html
```

Checks, `command:` / `http:` targets, the judge, run comparison and CI exit codes work exactly as in the [main README](../README.md).

## Programmatic use

```ts
import { loadSuite, runSuite, compare, renderHtml } from "@sharan1712/casebook";

const run = await runSuite(loadSuite("cases.yaml"), { skipJudge: true });
console.log(run.summary.pass_rate);
```

## Differences from the Python edition

- The target key is `js:` instead of `python:`. A suite can have both, so one file serves both editions (see `examples/unit_converter/cases.yaml`).
- `regex:` uses Python syntax in both editions. The TypeScript edition translates leading inline flags such as `(?i)` and named groups `(?P<name>...)`.
- `json_schema:` failure messages come from Ajv, so they are worded differently; pass/fail is the same.

CI runs both editions on the shared example suite and fails if they disagree on any case.

## Development

```bash
npm install
npm test          # node --test, no build needed
npm run typecheck
npm run build     # emits dist/ for publishing
```
