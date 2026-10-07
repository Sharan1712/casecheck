from __future__ import annotations

import json
import sys

import pytest

from casecheck.compare import compare
from casecheck.judge import Judge
from casecheck.runner import run_suite
from casecheck.suite import SuiteError, load_suite
from tests.conftest import fake_client


def test_example_suite_runs_with_one_known_bug(example_suite_path):
    run = run_suite(load_suite(example_suite_path), skip_judge=True)
    by_id = {c["id"]: c for c in run["cases"]}
    assert by_id["fahrenheit-to-celsius"]["passed"] is False
    assert all(c["passed"] for cid, c in by_id.items() if cid != "fahrenheit-to-celsius")
    assert by_id["km-to-miles"]["tool_calls"][0]["name"] == "convert"
    assert run["summary"]["total"] == 9 and run["summary"]["failed"] == 1


def test_judge_checks_use_the_injected_judge(example_suite_path):
    client, messages = fake_client()
    run = run_suite(load_suite(example_suite_path), tags=["judge"], judge=Judge(client=client))
    assert run["summary"]["total"] == 1 and run["summary"]["passed"] == 1
    assert run["summary"]["judge_tokens"] == {"input_tokens": 120, "output_tokens": 30}
    assert len(messages.calls) == 1


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ("cases: []", "target"),
        ("target: {python: a:b}\ncases: []", "non-empty"),
        ("target: {python: a:b}\ncases:\n  - id: x\n", "input"),
        (
            "target: {python: a:b}\ncases:\n  - input: hi\n    checks:\n      - startswith: h\n",
            "unknown check",
        ),
        ("target: {python: a:b}\ncases:\n  - {id: a, input: x}\n  - {id: a, input: y}\n", "duplicate"),
        ("target: {python: a:b}\ncases:\n  - input: x\n    checks:\n      - number: 3\n", "equals"),
        ("target: {js: a.ts:b}\ncases:\n  - input: x\n", "TypeScript edition"),
    ],
)
def test_suite_validation(write_suite, body, message):
    with pytest.raises(SuiteError, match=message):
        load_suite(write_suite(body))


def test_command_target_with_envelope(write_suite, tmp_path):
    script = tmp_path / "agent.py"
    script.write_text(
        "import json, sys\n"
        "text = sys.stdin.read()\n"
        "print(json.dumps({'output': text.upper(), 'usage': {'input_tokens': 3, 'output_tokens': 2}}))\n"
    )
    path = write_suite(
        f"target:\n  command: [{json.dumps(sys.executable)}, agent.py]\n"
        "cases:\n  - id: shout\n    input: hello\n    checks:\n      - equals: HELLO\n"
    )
    run = run_suite(load_suite(path))
    assert run["cases"][0]["passed"], run["cases"][0]
    assert run["summary"]["agent_tokens"] == {"input_tokens": 3, "output_tokens": 2}


def test_agent_exception_is_recorded(write_suite, tmp_path):
    (tmp_path / "boom.py").write_text("def agent(x):\n    raise ValueError('bad input')\n")
    path = write_suite("target:\n  python: boom.py:agent\ncases:\n  - id: a\n    input: x\n")
    case = run_suite(load_suite(path))["cases"][0]
    assert case["passed"] is False and "bad input" in case["error"]


def test_compare():
    base = {
        "started_at": "t0",
        "summary": {"pass_rate": 0.5},
        "cases": [
            {"id": "a", "passed": True},
            {"id": "b", "passed": False},
            {"id": "c", "passed": False},
            {"id": "gone", "passed": True},
        ],
    }
    cur = {
        "summary": {"pass_rate": 0.5},
        "cases": [
            {"id": "a", "passed": False},
            {"id": "b", "passed": True},
            {"id": "c", "passed": False},
            {"id": "d", "passed": True},
        ],
    }
    diff = compare(base, cur)
    assert diff["broken"] == ["a"] and diff["fixed"] == ["b"] and diff["still_failing"] == ["c"]
    assert diff["new"] == ["d"] and diff["removed"] == ["gone"]
