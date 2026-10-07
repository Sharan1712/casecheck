/** Calling the agent under test: a JS/TS function, a shell command or an HTTP endpoint. */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isResult, type Result, result } from "./result.ts";
import { type Suite, SuiteError } from "./suite.ts";

export type Target = (input: unknown) => Promise<Result>;

/** Commands and endpoints can return {"output": ..., "usage": ..., "tool_calls": ...}. */
function envelope(value: unknown): Result {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "output" in value) {
    const v = value as Record<string, any>;
    return result(v.output, { usage: v.usage ?? {}, tool_calls: v.tool_calls ?? [], meta: v.meta ?? {} });
  }
  return result(value);
}

function parseMaybeJson(text: string): Result {
  try {
    return envelope(JSON.parse(text));
  } catch {
    return result(text);
  }
}

export async function buildTarget(suite: Suite): Promise<{ target: Target; description: string }> {
  const t = suite.target;
  const base = dirname(suite.path);

  if ("js" in t) {
    const spec = String(t.js);
    const at = spec.lastIndexOf(":");
    if (at <= 0) throw new SuiteError(`js target '${spec}' must look like \`file.ts:function\` or \`package:function\``);
    const ref = spec.slice(0, at);
    const exportName = spec.slice(at + 1);
    const isFile = ref.startsWith(".") || /\.(m?[jt]s|c[jt]s)$/.test(ref);
    let mod: Record<string, unknown>;
    try {
      mod = await import(isFile ? pathToFileURL(resolve(base, ref)).href : ref);
    } catch (err: any) {
      throw new SuiteError(`cannot load ${ref}: ${err?.message ?? err}`);
    }
    const fn = mod[exportName];
    if (typeof fn !== "function") throw new SuiteError(`${ref} has no exported function '${exportName}'`);
    return {
      target: async (input) => {
        const value = await fn(input);
        return isResult(value) ? value : result(value);
      },
      description: `js ${spec}`,
    };
  }

  if ("command" in t) {
    const cmd = t.command;
    const argv: string[] = Array.isArray(cmd) ? cmd.map(String) : ["sh", "-c", String(cmd)];
    const [file, ...args] = argv;
    if (!file) throw new SuiteError("command target is empty");
    const target: Target = (input) =>
      new Promise((resolvePromise, reject) => {
        const child = spawn(file, args, { cwd: base, timeout: suite.timeout * 1000 });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) reject(new Error(`exit code ${code}: ${stderr.trim().slice(-500)}`));
          else resolvePromise(parseMaybeJson(stdout.trim()));
        });
        child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
      });
    return { target, description: `command ${Array.isArray(cmd) ? argv.join(" ") : cmd}` };
  }

  const http = t.http;
  const url: string | undefined = typeof http === "string" ? http : http?.url;
  const headers: Record<string, string> = typeof http === "string" ? {} : { ...(http?.headers ?? {}) };
  if (!url) throw new SuiteError("http target needs a `url:`");
  const target: Target = async (input) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(suite.timeout * 1000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    return parseMaybeJson(text);
  };
  return { target, description: `http ${url}` };
}
