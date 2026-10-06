"""LLM-as-judge: grades an output against a rubric you write, using Claude."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_EFFORT = "low"

SYSTEM_PROMPT = """You grade the output of an AI agent against a rubric written by the agent's developer.

Judge only what the rubric asks for. Do not reward length, politeness or style unless the rubric mentions them.
If the output partly meets the rubric, it fails: the rubric is a bar, not a score.
Give a one or two sentence reason that names the specific thing that passed or failed."""

VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "passed": {"type": "boolean"},
        "reason": {"type": "string"},
    },
    "required": ["passed", "reason"],
    "additionalProperties": False,
}


@dataclass
class Verdict:
    passed: bool
    reason: str
    error: bool = False
    usage: dict[str, int] = field(default_factory=dict)


def _render(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, indent=2, ensure_ascii=False)


class Judge:
    """Grades with Claude. Pass `client` to inject a pre-configured (or fake) Anthropic client."""

    def __init__(self, model: str | None = None, effort: str | None = None, client: Any = None):
        self.model = model or DEFAULT_MODEL
        self.effort = effort or DEFAULT_EFFORT
        self._client = client

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                import anthropic
            except ImportError as exc:  # pragma: no cover - depends on the environment
                raise RuntimeError(
                    "judge checks need the Anthropic SDK: pip install 'casebook[judge]'"
                ) from exc
            # Resolves credentials from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
            self._client = anthropic.Anthropic()
        return self._client

    def grade(self, rubric: str, case_input: Any, output: Any) -> Verdict:
        prompt = (
            f"<rubric>\n{rubric}\n</rubric>\n\n"
            f"<agent_input>\n{_render(case_input)}\n</agent_input>\n\n"
            f"<agent_output>\n{_render(output)}\n</agent_output>\n\n"
            "Does the agent output meet the rubric?"
        )
        try:
            client = self._get_client()
        except RuntimeError as exc:
            return Verdict(False, str(exc), error=True)

        try:
            import anthropic
        except ImportError:  # pragma: no cover - only with an injected client
            anthropic = None  # type: ignore[assignment]

        try:
            response = client.beta.messages.create(
                model=self.model,
                max_tokens=4096,
                # If the model declines to grade, Anthropic re-runs the request on its recommended fallback.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=SYSTEM_PROMPT,
                output_config={
                    "effort": self.effort,
                    "format": {"type": "json_schema", "schema": VERDICT_SCHEMA},
                },
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:
            if anthropic is not None and isinstance(exc, anthropic.AuthenticationError):
                reason = "no valid Anthropic credentials (set ANTHROPIC_API_KEY or run `ant auth login`)"
            elif anthropic is not None and isinstance(exc, anthropic.RateLimitError):
                reason = "rate limited by the Anthropic API; retry later or lower --workers"
            elif anthropic is not None and isinstance(exc, anthropic.APIStatusError):
                reason = f"Anthropic API error {exc.status_code}: {exc.message}"
            elif anthropic is not None and isinstance(exc, anthropic.APIConnectionError):
                reason = "could not reach the Anthropic API"
            else:
                reason = f"judge failed: {exc}"
            return Verdict(False, reason, error=True)

        usage = {
            "input_tokens": getattr(response.usage, "input_tokens", 0) or 0,
            "output_tokens": getattr(response.usage, "output_tokens", 0) or 0,
        }
        if response.stop_reason == "refusal":
            return Verdict(False, "the judge model declined to grade this output", error=True, usage=usage)

        text = next((b.text for b in response.content if b.type == "text"), "")
        try:
            data = json.loads(text)
            return Verdict(bool(data["passed"]), str(data["reason"]), usage=usage)
        except (json.JSONDecodeError, KeyError, TypeError):
            return Verdict(
                False, f"could not read the judge's verdict: {text[:200]!r}", error=True, usage=usage
            )
