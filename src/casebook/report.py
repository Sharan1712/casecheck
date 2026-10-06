"""Terminal output and the single-file HTML report."""

from __future__ import annotations

import html
import json
import os
import sys
from typing import Any, TextIO

from casebook.compare import status_by_case


def _color_enabled(stream: TextIO) -> bool:
    return stream.isatty() and "NO_COLOR" not in os.environ


def _paint(text: str, code: str, on: bool) -> str:
    return f"\033[{code}m{text}\033[0m" if on else text


def _pct(rate: float | None) -> str:
    return "–" if rate is None else f"{rate * 100:.0f}%"


def print_run(run: dict[str, Any], diff: dict[str, Any] | None = None, stream: TextIO | None = None) -> None:
    stream = stream or sys.stdout
    on = _color_enabled(stream)
    green, red, dim, yellow, bold = "32", "31", "2", "33", "1"
    badges = status_by_case(diff)

    w = stream.write
    w(f"\n{_paint(run['suite'], bold, on)}  {_paint(run['target'], dim, on)}\n\n")
    for case in run["cases"]:
        mark = _paint("✓", green, on) if case["passed"] else _paint("✗", red, on)
        badge = badges.get(case["id"])
        badge_txt = ""
        if badge == "fixed":
            badge_txt = " " + _paint("fixed", green, on)
        elif badge == "broken":
            badge_txt = " " + _paint("broke", red, on)
        elif badge == "new":
            badge_txt = " " + _paint("new", yellow, on)
        latency = f"{case['latency_ms']:.0f} ms"
        skipped = sum(1 for c in case.get("checks", []) if c.get("skipped"))
        if skipped and skipped == len(case["checks"]):
            mark = _paint("–", dim, on)
        note = f"  {_paint(f'({skipped} skipped)', dim, on)}" if skipped else ""
        w(f"  {mark} {case['id']}{badge_txt}  {_paint(latency, dim, on)}{note}\n")
        if case.get("error"):
            w(f"      {_paint('error', red, on)}  {case['error']}\n")
        for check in case.get("checks", []):
            if not check["passed"]:
                w(f"      {_paint('✗', red, on)} {check['label']}  {_paint(check['detail'], dim, on)}\n")

    s = run["summary"]
    color = green if s["failed"] == 0 else red
    passed_txt = f"{s['passed']}/{s['total']} passed"
    took_txt = f"in {run['duration_ms'] / 1000:.1f}s"
    w(
        f"\n  {_paint(passed_txt, color + ';' + bold, on)} ({_pct(s['pass_rate'])})  {_paint(took_txt, dim, on)}\n"
    )
    for key, label in (("agent_tokens", "agent"), ("judge_tokens", "judge")):
        tok = s.get(key) or {}
        if any(tok.values()):
            tok_txt = f"{label} tokens: {tok.get('input_tokens', 0)} in / {tok.get('output_tokens', 0)} out"
            w(f"  {_paint(tok_txt, dim, on)}\n")

    if diff:
        w(f"\n  vs. baseline ({diff.get('baseline_started_at')}): ")
        w(f"{_pct(diff['pass_rate_before'])} → {_pct(diff['pass_rate_after'])}\n")
        for key, label, code in (("fixed", "fixed", green), ("broken", "broke", red), ("new", "new", yellow)):
            if diff[key]:
                w(f"    {_paint(label, code, on)}: {', '.join(diff[key])}\n")
        if not (diff["fixed"] or diff["broken"]):
            w(f"    {_paint('no case changed status', dim, on)}\n")
    w("\n")


def _pre(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False)
    return f"<pre>{html.escape(str(text))}</pre>"


CSS = """
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
"""


def render_html(run: dict[str, Any], diff: dict[str, Any] | None = None) -> str:
    s = run["summary"]
    badges = status_by_case(diff)
    esc = html.escape

    stats = [
        (f"{s['passed']}/{s['total']}", "cases passed"),
        (_pct(s["pass_rate"]), "pass rate"),
        (f"{run['duration_ms'] / 1000:.1f}s", "total time"),
    ]
    tokens = s.get("agent_tokens") or {}
    if any(tokens.values()):
        stats.append(
            (f"{tokens.get('input_tokens', 0)} / {tokens.get('output_tokens', 0)}", "agent tokens in / out")
        )

    parts = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width,initial-scale=1'>",
        f"<title>casebook · {esc(run['suite'])}</title><style>{CSS}</style></head><body><main>",
        f"<h1>{esc(run['suite'])}</h1>",
        f"<div class='meta'>{esc(run['target'])} · {esc(run['started_at'])} · casebook {esc(run['casebook_version'])}"
        + (f" · judge {esc(run['judge_model'])}" if run.get("judge_model") else "")
        + "</div>",
        "<div class='summary'>"
        + "".join(f"<div class='stat'><b>{esc(v)}</b><span>{esc(k)}</span></div>" for v, k in stats)
        + "</div>",
    ]

    if diff:
        rows = []
        for key, label in (("fixed", "Fixed"), ("broken", "Broke"), ("new", "New")):
            if diff[key]:
                rows.append(f"<div><span class='{key}'>{label}:</span> {esc(', '.join(diff[key]))}</div>")
        if not rows:
            rows.append("<div class='meta'>No case changed status.</div>")
        parts.append(
            "<div class='diff'><div class='meta'>Compared with the run from "
            f"{esc(str(diff.get('baseline_started_at')))}: {_pct(diff['pass_rate_before'])} → "
            f"{_pct(diff['pass_rate_after'])}</div>{''.join(rows)}</div>"
        )

    ordered = sorted(run["cases"], key=lambda c: (c["passed"], c["id"]))
    for case in ordered:
        mark = "<span class='mark ok'>✓</span>" if case["passed"] else "<span class='mark bad'>✗</span>"
        checks = case.get("checks", [])
        if checks and all(c.get("skipped") for c in checks):
            mark = "<span class='mark'>–</span>"
        badge = badges.get(case["id"])
        badge_html = (
            f"<span class='badge {badge}'>{'broke' if badge == 'broken' else badge}</span>" if badge else ""
        )
        body = [f"<h3>Input</h3>{_pre(case['input'])}"]
        if case.get("error"):
            body.append(f"<h3>Error</h3>{_pre(case['error'])}")
        else:
            body.append(f"<h3>Output</h3>{_pre(case['output'])}")
        if case.get("checks"):
            items = []
            for ch in case["checks"]:
                cls, sym = ("ok", "✓") if ch["passed"] else ("bad", "✗")
                if ch.get("skipped"):
                    cls, sym = ("", "–")
                detail = f" <span class='d'>{esc(ch['detail'])}</span>" if ch.get("detail") else ""
                items.append(
                    f"<li><span class='{cls}'>{sym}</span><span>{esc(ch['label'])}{detail}</span></li>"
                )
            body.append(f"<h3>Checks</h3><ul class='checks'>{''.join(items)}</ul>")
        if case.get("tool_calls"):
            body.append(f"<h3>Tool calls</h3>{_pre(case['tool_calls'])}")
        if case.get("usage"):
            body.append(f"<h3>Usage</h3>{_pre(case['usage'])}")
        if case.get("meta"):
            body.append(f"<h3>Meta</h3>{_pre(case['meta'])}")
        open_attr = "" if case["passed"] else " open"
        parts.append(
            f"<details{open_attr}><summary>{mark}<span class='id'>{esc(case['id'])}</span>{badge_html}"
            f"<span class='lat'>{case['latency_ms']:.0f} ms</span></summary><div class='body'>{''.join(body)}</div></details>"
        )

    parts.append("</main></body></html>")
    return "".join(parts)
