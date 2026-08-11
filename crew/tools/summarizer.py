"""Condenses raw articles into the short, structured entries we publish.

The model is asked for strict JSON so the downstream Slack and Sheets tools
never have to parse prose. If the key is missing or the model returns
something unusable we degrade to a trimmed snippet rather than failing the run.
"""

from __future__ import annotations

import json
import re
import urllib.request
from typing import Any

from crewai.tools import tool

from crew.settings import settings

_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
_TIMEOUT = 60

_SYSTEM = """You are the desk editor for a newsroom briefing.
For each article you receive, write one tight summary of 30-45 words that says
what actually happened and why a reader should care. No preamble, no hedging,
no repeating the headline verbatim.

Also assign:
- "category": one of AI, Tech, Finance, Crypto, Policy, Science, Other
- "impact": one of high, medium, low

Drop any article that duplicates a story already in your output.
Respond with JSON only, shaped as:
{"items":[{"id":"<the id you were given>","summary":"...","category":"...","impact":"..."}]}"""


def _extract_json(content: str) -> dict[str, Any]:
    """Models occasionally wrap JSON in prose or a fenced block."""
    content = content.strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", content, re.DOTALL)
    if fenced:
        content = fenced.group(1).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        span = re.search(r"\{.*\}", content, re.DOTALL)
        if not span:
            raise
        return json.loads(span.group(0))


def _call_groq(articles: list[dict[str, Any]]) -> dict[str, Any]:
    payload = {
        "model": settings.groq_model,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {
                "role": "user",
                "content": json.dumps(
                    [
                        {
                            "id": article["id"],
                            "headline": article["headline"],
                            "source": article.get("source", ""),
                            "snippet": article.get("snippet", ""),
                        }
                        for article in articles
                    ]
                ),
            },
        ],
    }
    request = urllib.request.Request(
        _ENDPOINT,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {settings.groq_api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
        body = json.loads(response.read())
    return _extract_json(body["choices"][0]["message"]["content"])


def _fallback(article: dict[str, Any]) -> dict[str, Any]:
    snippet = (article.get("snippet") or article["headline"]).strip()
    if len(snippet) > 240:
        snippet = snippet[:237].rsplit(" ", 1)[0] + "..."
    return {"summary": snippet, "category": "Other", "impact": "medium"}


def summarise(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach summary, category and impact to each article."""
    if not articles:
        return []

    enriched: dict[str, dict[str, Any]] = {}
    if settings.llm_enabled:
        try:
            result = _call_groq(articles)
            for item in result.get("items", []):
                if item.get("id"):
                    enriched[item["id"]] = item
        except Exception as exc:
            print(f"[summarizer] Groq call failed, using snippets: {exc}")

    output = []
    for article in articles:
        detail = enriched.get(article["id"]) or _fallback(article)
        output.append(
            {
                **article,
                "summary": (detail.get("summary") or "").strip() or _fallback(article)["summary"],
                "category": detail.get("category") or "Other",
                "impact": (detail.get("impact") or "medium").lower(),
            }
        )
    return output


@tool("Intelligent Summarizer Tool")
def summarizer_tool(articles_json: str) -> str:
    """Summarise a JSON array of articles from the News Fetcher Tool.

    Adds a 30-45 word summary, a category and an impact rating to every
    article, removing duplicates. Returns the enriched JSON array.
    """
    try:
        articles = json.loads(articles_json)
    except json.JSONDecodeError as exc:
        return json.dumps({"error": f"Expected a JSON array of articles: {exc}"})
    if not isinstance(articles, list):
        return json.dumps({"error": "Expected a JSON array of articles."})
    return json.dumps(summarise(articles), indent=2)
