import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const EXAMPLE = resolve(import.meta.dirname, "../../examples/unit_converter/cases.yaml");

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "casecheck-"));
}

export function writeSuite(dir: string, body: string, name = "suite.yaml"): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

export function fakeClient(text = '{"passed": true, "reason": "states the amount and unit"}', stopReason = "end_turn") {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: any) => {
          calls.push(params);
          return {
            stop_reason: stopReason,
            content: [{ type: "text", text }],
            usage: { input_tokens: 120, output_tokens: 30 },
          };
        },
      },
    },
  };
  return { client, calls };
}
