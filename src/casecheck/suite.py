"""Loading and validating suite files."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

CHECK_KINDS = (
    "equals",
    "contains",
    "not_contains",
    "regex",
    "json_schema",
    "number",
    "judge",
    "max_latency_ms",
)


class SuiteError(ValueError):
    """The suite file is malformed. The message says where."""


@dataclass
class Check:
    kind: str
    arg: Any
    name: str | None = None

    @property
    def label(self) -> str:
        if self.name:
            return self.name
        if self.kind == "judge":
            rubric = self.arg if isinstance(self.arg, str) else self.arg.get("rubric", "")
            return f"judge: {_shorten(rubric, 60)}"
        if self.kind == "json_schema":
            return "matches JSON schema"
        if self.kind == "number":
            tolerance = self.arg.get("tolerance", 0)
            what = self.arg.get("path") or "number"
            return f"{what} ≈ {self.arg['equals']}" + (f" ± {tolerance}" if tolerance else "")
        if self.kind == "max_latency_ms":
            return f"latency ≤ {self.arg} ms"
        if self.kind in ("contains", "not_contains") and isinstance(self.arg, list):
            verb = "contains" if self.kind == "contains" else "does not contain"
            return f"{verb} " + ", ".join(repr(a) for a in self.arg)
        if self.kind in ("contains", "not_contains", "equals"):
            verb = {"contains": "contains", "not_contains": "does not contain", "equals": "equals"}[self.kind]
            return f"{verb} {_shorten(repr(self.arg), 60)}"
        if self.kind == "regex":
            return f"matches /{self.arg}/"
        return f"{self.kind}: {_shorten(repr(self.arg), 60)}"


@dataclass
class Case:
    id: str
    input: Any
    checks: list[Check]
    tags: list[str] = field(default_factory=list)


@dataclass
class Suite:
    name: str
    target: dict[str, Any]
    cases: list[Case]
    path: Path
    judge: dict[str, Any] = field(default_factory=dict)
    timeout: float = 60.0


def _shorten(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _parse_check(raw: Any, where: str) -> Check:
    if not isinstance(raw, dict):
        raise SuiteError(f'{where}: a check must be a mapping like `contains: "text"`')
    raw = dict(raw)
    name = raw.pop("name", None)
    kinds = [k for k in raw if k in CHECK_KINDS]
    unknown = [k for k in raw if k not in CHECK_KINDS]
    if unknown:
        raise SuiteError(f"{where}: unknown check {unknown[0]!r}. Known checks: {', '.join(CHECK_KINDS)}")
    if len(kinds) != 1:
        raise SuiteError(f"{where}: each check needs exactly one of: {', '.join(CHECK_KINDS)}")
    kind = kinds[0]
    arg = raw[kind]
    if kind == "regex" and not isinstance(arg, str):
        raise SuiteError(f"{where}: regex must be a string")
    if kind == "number" and not (isinstance(arg, dict) and "equals" in arg):
        raise SuiteError(f"{where}: number needs at least `equals:` (and optionally `tolerance:`, `path:`)")
    if kind == "judge" and not (isinstance(arg, str) or (isinstance(arg, dict) and "rubric" in arg)):
        raise SuiteError(f"{where}: judge needs a rubric, either as text or as `rubric:`")
    if kind == "json_schema" and not isinstance(arg, dict):
        raise SuiteError(f"{where}: json_schema must be a JSON Schema mapping")
    return Check(kind=kind, arg=arg, name=name)


def load_suite(path: str | Path) -> Suite:
    path = Path(path)
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SuiteError(f"{path}: file not found") from exc
    except yaml.YAMLError as exc:
        raise SuiteError(f"{path}: invalid YAML: {exc}") from exc

    if not isinstance(data, dict):
        raise SuiteError(f"{path}: expected a mapping with `target:` and `cases:`")

    target = data.get("target")
    if not isinstance(target, dict) or not ({"python", "command", "http"} & target.keys()):
        js_only = isinstance(target, dict) and "js" in target
        raise SuiteError(
            f"{path}: `target:` needs one of `python:`, `command:` or `http:`"
            + (" (this suite only has a `js:` target; run it with the TypeScript edition)" if js_only else "")
        )

    raw_cases = data.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise SuiteError(f"{path}: `cases:` must be a non-empty list")

    cases: list[Case] = []
    seen: set[str] = set()
    for i, raw in enumerate(raw_cases):
        where = f"{path.name}: case #{i + 1}"
        if not isinstance(raw, dict) or "input" not in raw:
            raise SuiteError(f"{where}: every case needs an `input:`")
        case_id = str(raw.get("id") or f"case-{i + 1}")
        if case_id in seen:
            raise SuiteError(f"{where}: duplicate id {case_id!r}")
        seen.add(case_id)
        checks = [
            _parse_check(c, f"{path.name}: case {case_id!r}, check #{j + 1}")
            for j, c in enumerate(raw.get("checks") or [])
        ]
        tags = raw.get("tags") or []
        cases.append(Case(id=case_id, input=raw["input"], checks=checks, tags=[str(t) for t in tags]))

    judge = data.get("judge") or {}
    if not isinstance(judge, dict):
        raise SuiteError(f"{path}: `judge:` must be a mapping (model, effort)")

    return Suite(
        name=str(data.get("name") or path.stem),
        target=target,
        cases=cases,
        path=path.resolve(),
        judge=judge,
        timeout=float(data.get("timeout", 60)),
    )
