"""Running a suite: call the agent for every case, then run its checks."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from casebook import __version__
from casebook.checks import CheckContext, CheckResult, run_check
from casebook.judge import Judge
from casebook.suite import Case, Suite
from casebook.targets import Target, build_target


def _add_usage(total: dict[str, int], usage: dict[str, Any]) -> None:
    if not usage:
        return
    for key in ("input_tokens", "output_tokens"):
        total[key] = total.get(key, 0) + int(usage.get(key, 0) or 0)


def run_case(case: Case, target: Target, judge: Judge | None, skip_judge: bool) -> dict[str, Any]:
    started = time.perf_counter()
    record: dict[str, Any] = {"id": case.id, "input": case.input, "tags": case.tags}
    try:
        result = target(case.input)
    except Exception as exc:
        latency = (time.perf_counter() - started) * 1000
        record.update(
            output=None,
            passed=False,
            error=f"{type(exc).__name__}: {exc}",
            latency_ms=round(latency, 1),
            checks=[],
        )
        return record

    latency = (time.perf_counter() - started) * 1000
    ctx = CheckContext(case_input=case.input, latency_ms=latency, judge=judge, skip_judge=skip_judge)
    results: list[CheckResult] = [run_check(check, result.output, ctx) for check in case.checks]

    judge_usage: dict[str, int] = {}
    for r in results:
        _add_usage(judge_usage, r.usage)

    record.update(
        output=result.output,
        passed=all(r.passed for r in results),
        latency_ms=round(latency, 1),
        checks=[r.to_dict() for r in results],
        usage=result.usage,
        tool_calls=result.tool_calls,
    )
    if result.meta:
        record["meta"] = result.meta
    if judge_usage:
        record["judge_usage"] = judge_usage
    if any(r.error for r in results):
        record["check_errors"] = True
    return record


def run_suite(
    suite: Suite,
    *,
    workers: int = 4,
    only: list[str] | None = None,
    tags: list[str] | None = None,
    judge_model: str | None = None,
    skip_judge: bool = False,
    judge: Judge | None = None,
) -> dict[str, Any]:
    target, description = build_target(suite)
    judge = judge or Judge(judge_model or suite.judge.get("model"), suite.judge.get("effort"))

    cases = suite.cases
    if only:
        cases = [c for c in cases if c.id in set(only)]
    if tags:
        cases = [c for c in cases if set(tags) & set(c.tags)]

    started_at = datetime.now(timezone.utc)
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        records = list(pool.map(lambda c: run_case(c, target, judge, skip_judge), cases))
    duration = (time.perf_counter() - t0) * 1000

    passed = sum(1 for r in records if r["passed"])
    agent_tokens: dict[str, int] = {}
    judge_tokens: dict[str, int] = {}
    for r in records:
        _add_usage(agent_tokens, r.get("usage") or {})
        _add_usage(judge_tokens, r.get("judge_usage") or {})

    return {
        "casebook_version": __version__,
        "suite": suite.name,
        "suite_path": str(suite.path),
        "target": description,
        "judge_model": None if skip_judge else judge.model,
        "started_at": started_at.isoformat(timespec="seconds"),
        "duration_ms": round(duration, 1),
        "summary": {
            "total": len(records),
            "passed": passed,
            "failed": len(records) - passed,
            "errors": sum(1 for r in records if r.get("error")),
            "pass_rate": round(passed / len(records), 4) if records else 0.0,
            "agent_tokens": agent_tokens,
            "judge_tokens": judge_tokens,
        },
        "cases": records,
    }
