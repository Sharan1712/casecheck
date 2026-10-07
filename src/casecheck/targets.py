"""Calling the agent under test: a Python function, a shell command or an HTTP endpoint."""

from __future__ import annotations

import importlib
import importlib.util
import json
import shlex
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

from casecheck.result import Result
from casecheck.suite import Suite, SuiteError

Target = Callable[[Any], Result]


def _envelope(value: Any) -> Result:
    """Commands and endpoints can return {"output": ..., "usage": ..., "tool_calls": ...}."""
    if isinstance(value, dict) and "output" in value:
        return Result(
            output=value["output"],
            usage=value.get("usage") or {},
            tool_calls=value.get("tool_calls") or [],
            meta=value.get("meta") or {},
        )
    return Result(output=value)


def _as_result(value: Any) -> Result:
    return value if isinstance(value, Result) else Result(output=value)


def _load_python(spec: str, base: Path) -> Callable[[Any], Any]:
    if ":" not in spec:
        raise SuiteError(f"python target {spec!r} must look like `module:function` or `file.py:function`")
    module_ref, func_name = spec.rsplit(":", 1)
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    if module_ref.endswith(".py"):
        file = (base / module_ref).resolve()
        mod_spec = importlib.util.spec_from_file_location(file.stem, file)
        if mod_spec is None or mod_spec.loader is None:
            raise SuiteError(f"cannot load {file}")
        module = importlib.util.module_from_spec(mod_spec)
        mod_spec.loader.exec_module(module)
    else:
        module = importlib.import_module(module_ref)
    func = getattr(module, func_name, None)
    if not callable(func):
        raise SuiteError(f"{module_ref} has no callable {func_name!r}")
    return func


def build_target(suite: Suite) -> tuple[Target, str]:
    """Returns the callable plus a short human description of it."""
    t = suite.target
    base = suite.path.parent

    if "python" in t:
        func = _load_python(str(t["python"]), base)
        return (lambda inp: _as_result(func(inp))), f"python {t['python']}"

    if "command" in t:
        cmd = t["command"]
        argv = shlex.split(cmd) if isinstance(cmd, str) else [str(c) for c in cmd]

        def run_command(inp: Any) -> Result:
            stdin = inp if isinstance(inp, str) else json.dumps(inp)
            proc = subprocess.run(
                argv, input=stdin, capture_output=True, text=True, cwd=base, timeout=suite.timeout
            )
            if proc.returncode != 0:
                raise RuntimeError(f"exit code {proc.returncode}: {proc.stderr.strip()[-500:]}")
            out = proc.stdout.strip()
            try:
                return _envelope(json.loads(out))
            except json.JSONDecodeError:
                return Result(output=out)

        return run_command, f"command {cmd if isinstance(cmd, str) else ' '.join(argv)}"

    http = t["http"]
    url = http if isinstance(http, str) else http.get("url")
    headers = {} if isinstance(http, str) else dict(http.get("headers") or {})
    if not url:
        raise SuiteError("http target needs a `url:`")

    def run_http(inp: Any) -> Result:
        body = json.dumps({"input": inp}).encode()
        req = urllib.request.Request(
            url, data=body, method="POST", headers={"Content-Type": "application/json", **headers}
        )
        try:
            with urllib.request.urlopen(req, timeout=suite.timeout) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode()[:500]}") from exc
        try:
            return _envelope(json.loads(raw))
        except json.JSONDecodeError:
            return Result(output=raw)

    return run_http, f"http {url}"
