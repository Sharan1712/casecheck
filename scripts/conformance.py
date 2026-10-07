"""Check that the Python and TypeScript editions agree on a suite.

Usage: python scripts/conformance.py PY_RUN.json TS_RUN.json

Fails if any case differs in pass/fail, in its check labels, or in which checks passed.
Failure details may be worded differently (each edition uses its own JSON Schema library).
"""

from __future__ import annotations

import json
import sys


def main(py_path: str, ts_path: str) -> int:
    py, ts = (json.load(open(p, encoding="utf-8")) for p in (py_path, ts_path))
    py_cases = {c["id"]: c for c in py["cases"]}
    ts_cases = {c["id"]: c for c in ts["cases"]}
    problems: list[str] = []

    if py_cases.keys() != ts_cases.keys():
        problems.append(f"case ids differ: {sorted(py_cases.keys() ^ ts_cases.keys())}")

    for cid in sorted(py_cases.keys() & ts_cases.keys()):
        a, b = py_cases[cid], ts_cases[cid]
        if a["passed"] != b["passed"]:
            problems.append(f"{cid}: python passed={a['passed']}, typescript passed={b['passed']}")
        checks_a = [(c["label"], c["passed"], c.get("skipped", False)) for c in a["checks"]]
        checks_b = [(c["label"], c["passed"], c.get("skipped", False)) for c in b["checks"]]
        if checks_a != checks_b:
            problems.append(f"{cid}: checks differ\n    python:     {checks_a}\n    typescript: {checks_b}")
        if sorted(a.keys()) != sorted(b.keys()):
            problems.append(f"{cid}: record fields differ: {sorted(a.keys() ^ b.keys())}")

    if problems:
        print("Editions disagree:")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"Editions agree on all {len(py_cases)} cases.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
