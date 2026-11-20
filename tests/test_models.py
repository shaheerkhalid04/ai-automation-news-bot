"""Checks for the model swap. CrewAI and Groq are replaced with fakes, so this
needs no keys and no `pip install crewai`. Run: python -m pytest -q tests
"""

import io
import json
import sys
import types
from dataclasses import replace

# crewai is heavy and only its @tool decorator is touched at import time.
_crewai = types.ModuleType("crewai")
_crewai_tools = types.ModuleType("crewai.tools")
_crewai_tools.tool = lambda *args, **kwargs: (lambda fn: fn)
_crewai.tools = _crewai_tools
sys.modules.setdefault("crewai", _crewai)
sys.modules.setdefault("crewai.tools", _crewai_tools)

from crew import settings as settings_module  # noqa: E402
from crew.tools import summarizer  # noqa: E402

RETIRED = {"llama-3.3-70b-versatile", "llama-3.1-8b-instant"}


def test_defaults_are_not_retired(monkeypatch):
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    monkeypatch.delenv("CREW_AGENT_MODEL", raising=False)
    fresh = settings_module.Settings()
    assert fresh.groq_model not in RETIRED
    assert fresh.crew_agent_model not in RETIRED


def test_summariser_asks_for_low_reasoning_with_headroom(monkeypatch):
    sent = {}

    class FakeResponse(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(request, timeout):
        sent.update(json.loads(request.data))
        reply = {"items": [{"id": "a1", "summary": "s", "category": "AI", "impact": "low"}]}
        body = {"choices": [{"message": {"content": json.dumps(reply)}}]}
        return FakeResponse(json.dumps(body).encode())

    monkeypatch.setattr(summarizer.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(
        summarizer, "settings", replace(summarizer.settings, groq_model="openai/gpt-oss-120b")
    )

    items = summarizer._call_batch([{"id": "a1", "headline": "h"}])

    assert items[0]["id"] == "a1"
    assert sent["reasoning_effort"] == "low"
    assert sent["max_tokens"] == 110 + 400 + settings_module.REASONING_HEADROOM


def test_non_reasoning_model_gets_no_reasoning_param(monkeypatch):
    monkeypatch.setattr(
        summarizer, "settings", replace(summarizer.settings, groq_model="some-other-model")
    )
    assert summarizer._token_ceiling(1) == 510
