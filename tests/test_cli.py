from __future__ import annotations

import json
import shutil

from casecheck.cli import EXIT_FAILED, EXIT_OK, EXIT_USAGE, main


def _copy_example(example_suite_path, tmp_path):
    dst = tmp_path / "example"
    shutil.copytree(example_suite_path.parent, dst)
    return dst


def test_run_fix_and_compare_with_last(example_suite_path, tmp_path, capsys):
    ex = _copy_example(example_suite_path, tmp_path)
    out = tmp_path / "runs"
    suite = str(ex / "cases.yaml")

    assert main(["run", suite, "--no-judge", "--out-dir", str(out)]) == EXIT_FAILED

    agent = ex / "agent.py"
    agent.write_text(agent.read_text().replace("value - 32 * 5 / 9", "(value - 32) * 5 / 9"))

    html = tmp_path / "report.html"
    code = main(
        ["run", suite, "--no-judge", "--out-dir", str(out), "--baseline", "last", "--html", str(html)]
    )
    assert code == EXIT_OK
    printed = capsys.readouterr().out
    assert "fixed" in printed and "fahrenheit-to-celsius" in printed
    assert "9/9 passed" in printed
    assert "fahrenheit-to-celsius" in html.read_text() and "fixed" in html.read_text()

    runs = sorted(out.glob("*.json"))
    assert len(runs) == 2
    diff_code = main(["compare", str(runs[0]), str(runs[1]), "--json"])
    diff = json.loads(capsys.readouterr().out)
    assert diff_code == EXIT_OK and diff["fixed"] == ["fahrenheit-to-celsius"]


def test_thresholds(example_suite_path, tmp_path):
    suite = str(example_suite_path)
    out = str(tmp_path / "runs")
    assert main(["run", suite, "--no-judge", "--out-dir", out, "--fail-under", "0.8"]) == EXIT_OK
    assert main(["run", suite, "--no-judge", "--out-dir", out, "--fail-under", "0.95"]) == EXIT_FAILED
    assert (
        main(["run", suite, "--no-judge", "--out-dir", out, "--baseline", "last", "--no-regressions"])
        == EXIT_OK
    )


def test_bad_suite_is_a_usage_error(tmp_path, capsys):
    bad = tmp_path / "bad.yaml"
    bad.write_text("cases: []")
    assert main(["run", str(bad)]) == EXIT_USAGE
    assert "target" in capsys.readouterr().err
