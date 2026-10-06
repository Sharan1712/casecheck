/** What an agent returns when it wants casebook to record more than the output. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface ToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

const RESULT = Symbol.for("casebook.Result");

export interface Result {
  output: unknown;
  usage?: Usage;
  tool_calls?: ToolCall[];
  meta?: Record<string, unknown>;
  readonly [RESULT]: true;
}

/**
 * Wrap an agent's output to also record token usage, tool calls and metadata in the trace.
 * Return a plain value from your agent for the simple case.
 */
export function result(
  output: unknown,
  extra: { usage?: Usage; tool_calls?: ToolCall[]; meta?: Record<string, unknown> } = {},
): Result {
  return { output, ...extra, [RESULT]: true };
}

export function isResult(value: unknown): value is Result {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[RESULT] === true;
}
