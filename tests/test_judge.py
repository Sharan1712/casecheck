from __future__ import annotations

from casecheck.judge import DEFAULT_MODEL, VERDICT_SCHEMA, Judge
from tests.conftest import fake_client


def test_judge_passes_and_reports_usage():
    client, messages = fake_client()
    verdict = Judge(client=client).grade("states amount and unit", "Convert 5 kg", {"text": "5 kg is 11 lb."})
    assert verdict.passed and not verdict.error
    assert verdict.usage == {"input_tokens": 120, "output_tokens": 30}

    call = messages.calls[0]
    assert call["model"] == DEFAULT_MODEL
    assert call["output_config"]["format"]["schema"] == VERDICT_SCHEMA
    assert call["output_config"]["effort"] == "low"
    assert call["fallbacks"] == "default"
    assert "<rubric>" in call["messages"][0]["content"]


def test_judge_failing_verdict():
    client, _ = fake_client('{"passed": false, "reason": "no unit"}')
    verdict = Judge(client=client).grade("rubric", "in", "out")
    assert not verdict.passed and verdict.reason == "no unit" and not verdict.error


def test_judge_refusal_is_an_error_not_a_pass():
    client, _ = fake_client("", stop_reason="refusal")
    verdict = Judge(client=client).grade("rubric", "in", "out")
    assert not verdict.passed and verdict.error


def test_judge_unreadable_verdict():
    client, _ = fake_client("definitely passes")
    verdict = Judge(client=client).grade("rubric", "in", "out")
    assert not verdict.passed and verdict.error


def test_model_and_effort_override():
    client, messages = fake_client()
    Judge(model="claude-sonnet-5-5", effort="medium", client=client).grade("r", "i", "o")
    assert messages.calls[0]["model"] == "claude-sonnet-5-5"
    assert messages.calls[0]["output_config"]["effort"] == "medium"
