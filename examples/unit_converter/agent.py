"""A tiny, deterministic "agent" for trying casecheck without an API key.

It parses a request like "Convert 10 km to miles", calls a conversion tool and returns
a structured answer. It has one deliberate bug, so the first run shows a failing case.
"""

from __future__ import annotations

import re

from casecheck import Result

UNITS = {
    "km": "km",
    "kilometre": "km",
    "kilometres": "km",
    "kilometer": "km",
    "kilometers": "km",
    "mi": "mi",
    "mile": "mi",
    "miles": "mi",
    "kg": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "lb": "lb",
    "lbs": "lb",
    "pound": "lb",
    "pounds": "lb",
    "c": "C",
    "celsius": "C",
    "f": "F",
    "fahrenheit": "F",
}

REQUEST = re.compile(r"(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s+(?:to|in|into)\s+([a-zA-Z]+)", re.IGNORECASE)


def convert(value: float, src: str, dst: str) -> float:
    """The 'tool' the agent calls."""
    if (src, dst) == ("km", "mi"):
        return value * 0.621371
    if (src, dst) == ("mi", "km"):
        return value / 0.621371
    if (src, dst) == ("kg", "lb"):
        return value * 2.20462
    if (src, dst) == ("lb", "kg"):
        return value / 2.20462
    if (src, dst) == ("C", "F"):
        return value * 9 / 5 + 32
    if (src, dst) == ("F", "C"):
        return value - 32 * 5 / 9  # bug: should be (value - 32) * 5 / 9
    raise ValueError(f"no conversion from {src} to {dst}")


def agent(request: str) -> Result:
    match = REQUEST.search(request)
    if not match:
        return Result(output={"text": "Sorry, I can't tell what to convert. Try 'Convert 10 km to miles'."})

    value, src_word, dst_word = float(match.group(1)), match.group(2).lower(), match.group(3).lower()
    src, dst = UNITS.get(src_word), UNITS.get(dst_word)
    if not src or not dst:
        unknown = src_word if not src else dst_word
        return Result(output={"text": f"Sorry, I can't convert {unknown} yet."})

    try:
        converted = round(convert(value, src, dst), 3)
    except ValueError:
        return Result(output={"text": f"Sorry, I can't convert {src} to {dst}."})

    return Result(
        output={"value": converted, "unit": dst, "text": f"{value:g} {src} is {converted:g} {dst}."},
        tool_calls=[
            {"name": "convert", "input": {"value": value, "from": src, "to": dst}, "output": converted}
        ],
        meta={"agent": "unit-converter", "version": "0.1"},
    )
