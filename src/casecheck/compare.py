"""Comparing two runs case by case: what got fixed, what broke."""

from __future__ import annotations

from typing import Any


def compare(baseline: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    before = {c["id"]: c["passed"] for c in baseline.get("cases", [])}
    after = {c["id"]: c["passed"] for c in current.get("cases", [])}

    fixed = [cid for cid, ok in after.items() if ok and before.get(cid) is False]
    broken = [cid for cid, ok in after.items() if not ok and before.get(cid) is True]
    still_failing = [cid for cid, ok in after.items() if not ok and before.get(cid) is False]
    new = [cid for cid in after if cid not in before]
    removed = [cid for cid in before if cid not in after]

    return {
        "baseline_started_at": baseline.get("started_at"),
        "pass_rate_before": baseline.get("summary", {}).get("pass_rate"),
        "pass_rate_after": current.get("summary", {}).get("pass_rate"),
        "fixed": fixed,
        "broken": broken,
        "still_failing": still_failing,
        "new": new,
        "removed": removed,
    }


def status_by_case(diff: dict[str, Any] | None) -> dict[str, str]:
    """Maps case id -> 'fixed' | 'broken' | 'new' for badges in reports."""
    if not diff:
        return {}
    out: dict[str, str] = {}
    for key in ("fixed", "broken", "new"):
        for cid in diff[key]:
            out[cid] = key
    return out
