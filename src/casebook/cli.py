"""casebook command line."""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from casebook import __version__
from casebook.compare import compare
from casebook.report import print_run, render_html
from casebook.runner import run_suite
from casebook.suite import SuiteError, load_suite

EXIT_OK, EXIT_FAILED, EXIT_USAGE = 0, 1, 2


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "suite"


def _load_run(path: str | Path) -> dict[str, Any]:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SuiteError(f"cannot read run file {path}: {exc}") from exc


def _previous_run(out_dir: Path, suite_slug: str) -> Path | None:
    runs = sorted(out_dir.glob(f"{suite_slug}-*.json"))
    return runs[-1] if runs else None


def cmd_run(args: argparse.Namespace) -> int:
    suite = load_suite(args.suite)
    out_dir = Path(args.out_dir)
    slug = _slug(suite.name)

    baseline_path: Path | None = None
    if args.baseline == "last":
        baseline_path = _previous_run(out_dir, slug)
        if baseline_path is None:
            print(
                "casebook: no previous run to compare with yet; this run becomes the baseline.",
                file=sys.stderr,
            )
    elif args.baseline:
        baseline_path = Path(args.baseline)

    run = run_suite(
        suite,
        workers=args.workers,
        only=args.only,
        tags=args.tag,
        judge_model=args.judge_model,
        skip_judge=args.no_judge,
    )
    if not run["cases"]:
        print("casebook: no cases matched --only/--tag", file=sys.stderr)
        return EXIT_USAGE

    diff = compare(_load_run(baseline_path), run) if baseline_path else None

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]  # milliseconds keep fast reruns apart
    run_path = out_dir / f"{slug}-{stamp}.json"
    run_path.write_text(json.dumps(run, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    print_run(run, diff)
    print(f"  run saved to {run_path}")
    if args.html:
        Path(args.html).write_text(render_html(run, diff), encoding="utf-8")
        print(f"  report written to {args.html}")
    print()

    failing = False
    if args.fail_under is not None and run["summary"]["pass_rate"] < args.fail_under:
        print(
            f"casebook: pass rate {run['summary']['pass_rate']:.0%} is below {args.fail_under:.0%}",
            file=sys.stderr,
        )
        failing = True
    if args.no_regressions and diff and diff["broken"]:
        print(f"casebook: {len(diff['broken'])} case(s) broke: {', '.join(diff['broken'])}", file=sys.stderr)
        failing = True
    if args.fail_under is None and not args.no_regressions and run["summary"]["failed"]:
        failing = True
    return EXIT_FAILED if failing else EXIT_OK


def cmd_compare(args: argparse.Namespace) -> int:
    base, current = _load_run(args.baseline), _load_run(args.current)
    diff = compare(base, current)
    if args.json:
        print(json.dumps(diff, indent=2))
    else:
        print_run(current, diff)
    return EXIT_FAILED if diff["broken"] else EXIT_OK


def cmd_report(args: argparse.Namespace) -> int:
    run = _load_run(args.run)
    diff = compare(_load_run(args.baseline), run) if args.baseline else None
    Path(args.output).write_text(render_html(run, diff), encoding="utf-8")
    print(f"report written to {args.output}")
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="casebook", description="Test cases for AI agents.")
    parser.add_argument("--version", action="version", version=f"casebook {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run a suite of cases against your agent")
    run.add_argument("suite", help="path to the suite YAML file")
    run.add_argument(
        "--out-dir", default=".casebook/runs", help="where run files are saved (default: .casebook/runs)"
    )
    run.add_argument("--html", metavar="PATH", help="also write a single-file HTML report")
    run.add_argument("--baseline", metavar="RUN", help="compare with a previous run file, or `last`")
    run.add_argument(
        "--fail-under", type=float, metavar="RATE", help="exit 1 if the pass rate is below RATE (0-1)"
    )
    run.add_argument(
        "--no-regressions", action="store_true", help="exit 1 if any case that passed in the baseline fails"
    )
    run.add_argument("--workers", type=int, default=4, help="cases run in parallel (default: 4)")
    run.add_argument("--only", nargs="+", metavar="ID", help="run only these case ids")
    run.add_argument("--tag", nargs="+", metavar="TAG", help="run only cases with these tags")
    run.add_argument(
        "--judge-model", metavar="MODEL", help="model for judge checks (default: claude-opus-5-5)"
    )
    run.add_argument("--no-judge", action="store_true", help="skip judge checks (no API calls)")
    run.set_defaults(func=cmd_run)

    cmp_ = sub.add_parser("compare", help="compare two run files case by case")
    cmp_.add_argument("baseline")
    cmp_.add_argument("current")
    cmp_.add_argument("--json", action="store_true", help="print the comparison as JSON")
    cmp_.set_defaults(func=cmd_compare)

    rep = sub.add_parser("report", help="write the HTML report for a saved run")
    rep.add_argument("run")
    rep.add_argument("-o", "--output", default="casebook-report.html")
    rep.add_argument("--baseline", metavar="RUN", help="show fixed/broken against this run")
    rep.set_defaults(func=cmd_report)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except SuiteError as exc:
        print(f"casebook: {exc}", file=sys.stderr)
        return EXIT_USAGE


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
