/** LLM-as-judge: grades an output against a rubric you write, using Claude. */
import type { Usage } from "./result.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_EFFORT = "low";

export const SYSTEM_PROMPT = `You grade the output of an AI agent against a rubric written by the agent's developer.

Judge only what the rubric asks for. Do not reward length, politeness or style unless the rubric mentions them.
If the output partly meets the rubric, it fails: the rubric is a bar, not a score.
Give a one or two sentence reason that names the specific thing that passed or failed.`;

export const VERDICT_SCHEMA = {
  type: "object",
  properties: { passed: { type: "boolean" }, reason: { type: "string" } },
  required: ["passed", "reason"],
  additionalProperties: false,
};

export interface Verdict {
  passed: boolean;
  reason: string;
  error?: boolean;
  usage?: Usage;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const render = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** Grades with Claude. Pass `client` to inject a pre-configured (or fake) Anthropic client. */
export class Judge {
  readonly model: string;
  readonly effort: string;
  private client: any;

  constructor(opts: { model?: string; effort?: string; client?: unknown } = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.effort = opts.effort ?? DEFAULT_EFFORT;
    this.client = opts.client;
  }

  private async getClient(): Promise<{ client: any; sdk: any }> {
    let sdk: any;
    try {
      sdk = await import("@anthropic-ai/sdk");
    } catch {
      if (!this.client) {
        throw new Error("judge checks need the Anthropic SDK: npm install @anthropic-ai/sdk");
      }
    }
    // Resolves credentials from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
    this.client ??= new sdk.default();
    return { client: this.client, sdk };
  }

  async grade(rubric: string, caseInput: unknown, output: unknown): Promise<Verdict> {
    const prompt =
      `<rubric>\n${rubric}\n</rubric>\n\n` +
      `<agent_input>\n${render(caseInput)}\n</agent_input>\n\n` +
      `<agent_output>\n${render(output)}\n</agent_output>\n\n` +
      "Does the agent output meet the rubric?";

    let client: any;
    let sdk: any;
    try {
      ({ client, sdk } = await this.getClient());
    } catch (err: any) {
      return { passed: false, reason: err.message, error: true };
    }

    let response: any;
    try {
      response = await client.beta.messages.create({
        model: this.model,
        max_tokens: 4096,
        // If the model declines to grade, Anthropic re-runs the request on its recommended fallback.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        output_config: {
          effort: this.effort as Effort,
          format: { type: "json_schema", schema: VERDICT_SCHEMA },
        },
        messages: [{ role: "user", content: prompt }],
      });
    } catch (err: any) {
      let reason = `judge failed: ${err?.message ?? err}`;
      if (sdk?.AuthenticationError && err instanceof sdk.AuthenticationError) {
        reason = "no valid Anthropic credentials (set ANTHROPIC_API_KEY or run `ant auth login`)";
      } else if (sdk?.RateLimitError && err instanceof sdk.RateLimitError) {
        reason = "rate limited by the Anthropic API; retry later or lower --workers";
      } else if (sdk?.APIConnectionError && err instanceof sdk.APIConnectionError) {
        reason = "could not reach the Anthropic API";
      } else if (sdk?.APIError && err instanceof sdk.APIError) {
        reason = `Anthropic API error ${err.status}: ${err.message}`;
      }
      return { passed: false, reason, error: true };
    }

    const usage: Usage = {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
    };
    if (response.stop_reason === "refusal") {
      return { passed: false, reason: "the judge model declined to grade this output", error: true, usage };
    }
    const text: string = response.content.find((b: any) => b.type === "text")?.text ?? "";
    try {
      const data = JSON.parse(text);
      if (typeof data.passed !== "boolean" || typeof data.reason !== "string") throw new Error("bad shape");
      return { passed: data.passed, reason: data.reason, usage };
    } catch {
      return {
        passed: false,
        reason: `could not read the judge's verdict: ${JSON.stringify(text.slice(0, 200))}`,
        error: true,
        usage,
      };
    }
  }
}
