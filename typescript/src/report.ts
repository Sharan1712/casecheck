/** Terminal output and the single-file HTML report (same look as the Python edition). */
import { type Diff, statusByCase } from "./compare.ts";
import type { RunRecord } from "./runner.ts";

interface Writer {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

const pct = (rate: number | undefined | null): string => (rate == null ? "–" : `${Math.round(rate * 100)}%`);

export function printRun(run: RunRecord, diff?: Diff | null, stream: Writer = process.stdout): void {
  const on = Boolean(stream.isTTY) && !("NO_COLOR" in process.env);
  const paint = (text: string, code: string) => (on ? `\x1b[${code}m${text}\x1b[0m` : text);
  const [green, red, dim, yellow, bold] = ["32", "31", "2", "33", "1"];
  const badges = statusByCase(diff);
  const w = (s: string) => stream.write(s);

  w(`\n${paint(run.suite, bold)}  ${paint(run.target, dim)}\n\n`);
  for (const c of run.cases) {
    let mark = c.passed ? paint("✓", green) : paint("✗", red);
    const badge = badges.get(c.id);
    const badgeTxt =
      badge === "fixed" ? ` ${paint("fixed", green)}` : badge === "broken" ? ` ${paint("broke", red)}` : badge === "new" ? ` ${paint("new", yellow)}` : "";
    const skipped = c.checks.filter((ch) => ch.skipped).length;
    if (skipped && skipped === c.checks.length) mark = paint("–", dim);
    const note = skipped ? `  ${paint(`(${skipped} skipped)`, dim)}` : "";
    w(`  ${mark} ${c.id}${badgeTxt}  ${paint(`${Math.round(c.latency_ms)} ms`, dim)}${note}\n`);
    if (c.error) w(`      ${paint("error", red)}  ${c.error}\n`);
    for (const ch of c.checks) if (!ch.passed) w(`      ${paint("✗", red)} ${ch.label}  ${paint(ch.detail, dim)}\n`);
  }

  const s = run.summary;
  const color = s.failed === 0 ? green : red;
  w(`\n  ${paint(`${s.passed}/${s.total} passed`, `${color};${bold}`)} (${pct(s.pass_rate)})  ${paint(`in ${(run.duration_ms / 1000).toFixed(1)}s`, dim)}\n`);
  for (const [key, label] of [["agent_tokens", "agent"], ["judge_tokens", "judge"]] as const) {
    const tok = s[key] ?? {};
    if (Object.values(tok).some(Boolean)) {
      w(`  ${paint(`${label} tokens: ${tok.input_tokens ?? 0} in / ${tok.output_tokens ?? 0} out`, dim)}\n`);
    }
  }
  if (diff) {
    w(`\n  vs. baseline (${diff.baseline_started_at}): ${pct(diff.pass_rate_before)} → ${pct(diff.pass_rate_after)}\n`);
    for (const [key, label, code] of [["fixed", "fixed", green], ["broken", "broke", red], ["new", "new", yellow]] as const) {
      if (diff[key].length) w(`    ${paint(label, code)}: ${diff[key].join(", ")}\n`);
    }
    if (!diff.fixed.length && !diff.broken.length) w(`    ${paint("no case changed status", dim)}\n`);
  }
  w("\n");
}

const esc = (value: unknown): string =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const pre = (value: unknown): string =>
  `<pre>${esc(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</pre>`;

const CSS = `
:root{--paper:#f6f1ea;--card:#fbf8f3;--ink:#1b1916;--muted:#5c554c;--rule:#ded4c6;--accent:#9e4128;--ok:#2f6b47;--bad:#a3341f;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--paper:#171512;--card:#201d19;--ink:#f2ece3;--muted:#a99f92;--rule:#37322c;--accent:#e3906f;--ok:#7fc79a;--bad:#ef8c76;--warn:#e6b85c}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 20px 64px}h1{font:400 32px/1.15 Georgia,serif;margin:0 0 4px}
.meta{color:var(--muted);font-size:13px}.summary{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}
.stat{background:var(--card);border:1px solid var(--rule);border-radius:12px;padding:12px 16px;min-width:140px}
.stat b{display:block;font:400 26px Georgia,serif}.stat span{color:var(--muted);font-size:13px}
details{background:var(--card);border:1px solid var(--rule);border-radius:12px;margin:8px 0}
summary{cursor:pointer;padding:12px 16px;display:flex;gap:12px;align-items:center;list-style:none}
summary::-webkit-details-marker{display:none}.mark{font-weight:700;width:1em}.ok{color:var(--ok)}.bad{color:var(--bad)}
.id{font-family:ui-monospace,monospace;font-size:14px;flex:1}.lat{color:var(--muted);font-size:13px}
.badge{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
.fixed{color:var(--ok)}.broken{color:var(--bad)}.new{color:var(--warn)}
.body{padding:0 16px 16px;border-top:1px solid var(--rule)}h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px}
pre{background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:10px 12px;overflow:auto;font-size:13px;margin:0;white-space:pre-wrap;word-break:break-word}
ul.checks{list-style:none;padding:0;margin:0}ul.checks li{padding:4px 0;display:flex;gap:8px}ul.checks .d{color:var(--muted)}
.diff{background:var(--card);border:1px solid var(--rule);border-radius:12px;padding:12px 16px;margin:0 0 24px}
`;

export function renderHtml(run: RunRecord, diff?: Diff | null): string {
  const s = run.summary;
  const badges = statusByCase(diff);
  const stats: Array<[string, string]> = [
    [`${s.passed}/${s.total}`, "cases passed"],
    [pct(s.pass_rate), "pass rate"],
    [`${(run.duration_ms / 1000).toFixed(1)}s`, "total time"],
  ];
  const tokens = s.agent_tokens ?? {};
  if (Object.values(tokens).some(Boolean)) stats.push([`${tokens.input_tokens ?? 0} / ${tokens.output_tokens ?? 0}`, "agent tokens in / out"]);

  const parts = [
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width,initial-scale=1'>",
    `<title>casebook · ${esc(run.suite)}</title><style>${CSS}</style></head><body><main>`,
    `<h1>${esc(run.suite)}</h1>`,
    `<div class='meta'>${esc(run.target)} · ${esc(run.started_at)} · casebook ${esc(run.casebook_version)}` +
      (run.judge_model ? ` · judge ${esc(run.judge_model)}` : "") +
      "</div>",
    `<div class='summary'>${stats.map(([v, k]) => `<div class='stat'><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}</div>`,
  ];

  if (diff) {
    const rows: string[] = [];
    for (const [key, label] of [["fixed", "Fixed"], ["broken", "Broke"], ["new", "New"]] as const) {
      if (diff[key].length) rows.push(`<div><span class='${key}'>${label}:</span> ${esc(diff[key].join(", "))}</div>`);
    }
    if (!rows.length) rows.push("<div class='meta'>No case changed status.</div>");
    parts.push(
      `<div class='diff'><div class='meta'>Compared with the run from ${esc(String(diff.baseline_started_at))}: ` +
        `${pct(diff.pass_rate_before)} → ${pct(diff.pass_rate_after)}</div>${rows.join("")}</div>`,
    );
  }

  const ordered = [...run.cases].sort((a, b) => Number(a.passed) - Number(b.passed) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of ordered) {
    let mark = c.passed ? "<span class='mark ok'>✓</span>" : "<span class='mark bad'>✗</span>";
    if (c.checks.length && c.checks.every((ch) => ch.skipped)) mark = "<span class='mark'>–</span>";
    const badge = badges.get(c.id);
    const badgeHtml = badge ? `<span class='badge ${badge}'>${badge === "broken" ? "broke" : badge}</span>` : "";
    const body = [`<h3>Input</h3>${pre(c.input)}`];
    body.push(c.error ? `<h3>Error</h3>${pre(c.error)}` : `<h3>Output</h3>${pre(c.output)}`);
    if (c.checks.length) {
      const items = c.checks.map((ch) => {
        let [cls, sym] = ch.passed ? ["ok", "✓"] : ["bad", "✗"];
        if (ch.skipped) [cls, sym] = ["", "–"];
        const detail = ch.detail ? ` <span class='d'>${esc(ch.detail)}</span>` : "";
        return `<li><span class='${cls}'>${sym}</span><span>${esc(ch.label)}${detail}</span></li>`;
      });
      body.push(`<h3>Checks</h3><ul class='checks'>${items.join("")}</ul>`);
    }
    if (c.tool_calls?.length) body.push(`<h3>Tool calls</h3>${pre(c.tool_calls)}`);
    if (c.usage && Object.keys(c.usage).length) body.push(`<h3>Usage</h3>${pre(c.usage)}`);
    if (c.meta && Object.keys(c.meta).length) body.push(`<h3>Meta</h3>${pre(c.meta)}`);
    parts.push(
      `<details${c.passed ? "" : " open"}><summary>${mark}<span class='id'>${esc(c.id)}</span>${badgeHtml}` +
        `<span class='lat'>${Math.round(c.latency_ms)} ms</span></summary><div class='body'>${body.join("")}</div></details>`,
    );
  }
  parts.push("</main></body></html>");
  return parts.join("");
}
