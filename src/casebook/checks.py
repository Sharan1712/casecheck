"""Deterministic checks plus the judge check."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

import jsonschema

from casebook.judge import Judge
from casebook.suite import Check

NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?(?:[eE]-?\d+)?")


@dataclass
class CheckResult:
    label: str
    kind: str
    passed: bool
    detail: str = ""
    error: bool = False
    skipped: bool = False
    usage: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "label": self.label,
            "kind": self.kind,
            "passed": self.passed,
            "detail": self.detail,
        }
        if self.error:
            data["error"] = True
        if self.skipped:
            data["skipped"] = True
        if self.usage:
            data["usage"] = self.usage
        return data


@dataclass
class CheckContext:
    case_input: Any
    latency_ms: float
    judge: Judge | None = None
    skip_judge: bool = False


def as_text(output: Any) -> str:
    return output if isinstance(output, str) else json.dumps(output, ensure_ascii=False, sort_keys=True)


def as_json(output: Any) -> Any:
    if isinstance(output, str):
        return json.loads(output)
    return output


def _dig(value: Any, path: str) -> Any:
    for part in path.split("."):
        if isinstance(value, list):
            value = value[int(part)]
        else:
            value = value[part]
    return value


def _number(output: Any, path: str | None) -> float:
    if path:
        return float(_dig(as_json(output), path))
    if isinstance(output, (int, float)) and not isinstance(output, bool):
        return float(output)
    match = NUMBER_RE.search(as_text(output))
    if not match:
        raise ValueError("no number in the output")
    return float(match.group().replace(",", "."))


def run_check(check: Check, output: Any, ctx: CheckContext) -> CheckResult:
    label, kind, arg = check.label, check.kind, check.arg

    def ok(passed: bool, detail: str = "") -> CheckResult:
        return CheckResult(label, kind, passed, detail)

    try:
        if kind == "equals":
            if isinstance(arg, str):
                actual = as_text(output).strip()
                return ok(actual == arg.strip(), "" if actual == arg.strip() else f"got {actual[:120]!r}")
            actual = as_json(output)
            return ok(actual == arg, "" if actual == arg else f"got {json.dumps(actual)[:120]}")

        if kind == "contains":
            needles = arg if isinstance(arg, list) else [arg]
            text = as_text(output)
            missing = [str(n) for n in needles if str(n).lower() not in text.lower()]
            return ok(not missing, f"missing {', '.join(repr(m) for m in missing)}" if missing else "")

        if kind == "not_contains":
            needles = arg if isinstance(arg, list) else [arg]
            text = as_text(output)
            found = [str(n) for n in needles if str(n).lower() in text.lower()]
            return ok(not found, f"found {', '.join(repr(f) for f in found)}" if found else "")

        if kind == "regex":
            hit = re.search(arg, as_text(output))
            return ok(bool(hit), "" if hit else f"no match for /{arg}/")

        if kind == "json_schema":
            try:
                jsonschema.validate(as_json(output), arg)
            except json.JSONDecodeError:
                return ok(False, "output is not valid JSON")
            except jsonschema.ValidationError as exc:
                where = "/".join(str(p) for p in exc.absolute_path) or "(root)"
                return ok(False, f"{where}: {exc.message}")
            return ok(True)

        if kind == "number":
            expected = float(arg["equals"])
            tolerance = float(arg.get("tolerance", 0))
            actual = _number(output, arg.get("path"))
            within = abs(actual - expected) <= tolerance
            return ok(within, "" if within else f"got {actual:g}, expected {expected:g} ± {tolerance:g}")

        if kind == "max_latency_ms":
            within = ctx.latency_ms <= float(arg)
            return ok(within, "" if within else f"took {ctx.latency_ms:.0f} ms")

        if kind == "judge":
            if ctx.skip_judge:
                return CheckResult(label, kind, True, "skipped (--no-judge)", skipped=True)
            judge = ctx.judge or Judge()
            if isinstance(arg, dict) and (arg.get("model") or arg.get("effort")):
                judge = Judge(arg.get("model") or judge.model, arg.get("effort") or judge.effort)
            rubric = arg if isinstance(arg, str) else arg["rubric"]
            verdict = judge.grade(rubric, ctx.case_input, output)
            return CheckResult(
                label, kind, verdict.passed, verdict.reason, error=verdict.error, usage=verdict.usage
            )

    except Exception as exc:  # a malformed output must fail the check, not crash the run
        return CheckResult(label, kind, False, f"{type(exc).__name__}: {exc}", error=True)

    raise AssertionError(f"unhandled check kind {kind}")  # pragma: no cover
