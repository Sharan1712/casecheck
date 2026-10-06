from __future__ import annotations

import pytest

from casecheck.checks import CheckContext, run_check
from casecheck.suite import Check


def ctx(latency: float = 10.0) -> CheckContext:
    return CheckContext(case_input="x", latency_ms=latency, skip_judge=True)


@pytest.mark.parametrize(
    ("kind", "arg", "output", "passed"),
    [
        ("equals", "hello", " hello ", True),
        ("equals", "hello", "hello!", False),
        ("equals", {"a": 1}, {"a": 1}, True),
        ("equals", {"a": 1}, '{"a": 2}', False),
        ("contains", "Paris", "The capital is paris.", True),
        ("contains", ["Paris", "France"], "Paris", False),
        ("not_contains", "error", "all good", True),
        ("not_contains", ["error", "sorry"], "Sorry about that", False),
        ("regex", r"\d{4}-\d{2}-\d{2}", "due 2026-10-06", True),
        ("regex", r"^\d+$", "12a", False),
        ("number", {"equals": 6.21, "tolerance": 0.01}, "about 6.214 miles", True),
        ("number", {"equals": 100, "tolerance": 0.1}, {"value": 158.2}, False),
        ("number", {"path": "value", "equals": 100, "tolerance": 0.1}, {"value": 100.04}, True),
        ("number", {"path": "items.1", "equals": 3}, '{"items": [1, 3]}', True),
        ("number", {"equals": 1, "tolerance": 0.001}, "1,0005", True),
    ],
)
def test_deterministic_checks(kind, arg, output, passed):
    result = run_check(Check(kind, arg), output, ctx())
    assert result.passed is passed, result.detail
    assert result.error is False


def test_failure_details_are_specific():
    assert "missing 'France'" in run_check(Check("contains", ["Paris", "France"]), "Paris", ctx()).detail
    assert "got 158.2" in run_check(Check("number", {"path": "v", "equals": 100}), {"v": 158.2}, ctx()).detail


def test_json_schema():
    schema = {"type": "object", "required": ["value"], "properties": {"value": {"type": "number"}}}
    assert run_check(Check("json_schema", schema), {"value": 1.5}, ctx()).passed
    bad = run_check(Check("json_schema", schema), {"value": "1.5"}, ctx())
    assert not bad.passed and "value" in bad.detail
    not_json = run_check(Check("json_schema", schema), "not json", ctx())
    assert not not_json.passed and "not valid JSON" in not_json.detail


def test_latency():
    assert run_check(Check("max_latency_ms", 100), "x", ctx(latency=50)).passed
    assert not run_check(Check("max_latency_ms", 100), "x", ctx(latency=150)).passed


def test_malformed_output_fails_the_check_instead_of_crashing():
    result = run_check(Check("number", {"path": "missing", "equals": 1}), {"value": 1}, ctx())
    assert not result.passed and result.error and "KeyError" in result.detail


def test_judge_skipped():
    result = run_check(Check("judge", "says hello"), "hello", ctx())
    assert result.passed and result.skipped
