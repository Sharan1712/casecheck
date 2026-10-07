from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "unit_converter" / "cases.yaml"


class FakeMessages:
    def __init__(self, text: str, stop_reason: str = "end_turn"):
        self.text = text
        self.stop_reason = stop_reason
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            content=[SimpleNamespace(type="text", text=self.text)],
            usage=SimpleNamespace(input_tokens=120, output_tokens=30),
        )


def fake_client(
    text: str = '{"passed": true, "reason": "states the amount and unit"}', stop_reason="end_turn"
):
    messages = FakeMessages(text, stop_reason)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


@pytest.fixture
def example_suite_path() -> Path:
    return EXAMPLE


@pytest.fixture
def write_suite(tmp_path):
    def _write(body: str, name: str = "suite.yaml") -> Path:
        path = tmp_path / name
        path.write_text(body, encoding="utf-8")
        return path

    return _write
