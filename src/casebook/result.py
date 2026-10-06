from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Result:
    """What an agent returns when it wants casebook to record more than the output.

    Return a plain value (str, dict, list, number) from your agent for the simple case.
    Return a Result to also record token usage and tool calls in the trace.
    """

    output: Any
    usage: dict[str, int] = field(default_factory=dict)
    """Token usage, e.g. {"input_tokens": 812, "output_tokens": 64}."""
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    """Tool calls the agent made, e.g. [{"name": "convert", "input": {...}, "output": ...}]."""
    meta: dict[str, Any] = field(default_factory=dict)
    """Anything else worth keeping in the trace (model name, prompt version, ...)."""
