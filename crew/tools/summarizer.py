"""Condenses raw articles into the short, structured entries we publish.

The model is asked for strict JSON so the downstream Slack and Sheets tools
never have to parse prose. Work is sent in small batches: Groq's free tier
counts max_tokens against a per-minute allowance, so one oversized request gets
rejected outright even when the reply would have been short.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from typing import Any

from crewai.tools import tool

from crew.settings import settings

_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
_TIMEOUT = 60
_BATCH_SIZE = 10
_MAX_RETRIES = 2

_SYSTEM = """You are the desk editor for a newsroom briefing.
For each article, write one tight summary of 20-40 words saying what happened
and why a reader should care. No preamble, no hedging, and never just restate
the headline.

You will often have only a headline and a publisher, with no article body. When
that is all you have, explain what the headline means and why it matters to
someone following this beat. Never invent specifics you were not given: no
numbers, dates, names or quotes that are not in the input.

Also assign:
- "category": one of AI, Tech, Finance, Crypto, Policy, Science, Other
- "impact": one of high, medium, low

Keep every article unless it covers the same event as one you have already
written up, in which case keep only the stronger one. Return one entry for
every article you keep, reusing the id you were given.

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


def _token_ceiling(count: int) -> int:
    """Reserve only what a batch can plausibly produce.

    Groq counts max_tokens against the tokens-per-minute allowance as
    *requested* tokens, so an oversized ceiling gets the whole call rejected.
    """
    return min(4000, count * 110 + 400)


def _call_batch(articles: list[dict[str, Any]], attempt: int = 0) -> list[dict[str, Any]]:
    payload = {
        "model": settings.groq_model,
        "temperature": 0.2,
        "max_tokens": _token_ceiling(len(articles)),
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

    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 429 and attempt < _MAX_RETRIES:
            detail = exc.read().decode(errors="replace")
            # The error body tells us how long to wait; honour it.
            match = re.search(r"try again in ([\d.]+)s", detail)
            wait = min(20.0, float(match.group(1)) + 0.5 if match else 6.0)
            print(f"[summarizer] rate limited, retrying in {wait:.1f}s")
            time.sleep(wait)
            return _call_batch(articles, attempt + 1)
        raise

    return _extract_json(body["choices"][0]["message"]["content"]).get("items", [])


def _fallback(article: dict[str, Any]) -> dict[str, Any]:
    snippet = (article.get("snippet") or article["headline"]).strip()
    if len(snippet) > 240:
        snippet = snippet[:237].rsplit(" ", 1)[0] + "..."
    return {"summary": snippet, "category": "Other", "impact": "medium"}


def summarise(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach summary, category and impact to each article.

    An article the editor saw but left out was a duplicate, so it is dropped.
    An article whose batch errored was never looked at, so it falls back to its
    snippet rather than being lost to an outage.
    """
    if not articles:
        return []

    enriched: dict[str, dict[str, Any]] = {}
    covered: set[str] = set()

    if settings.llm_enabled:
        for start in range(0, len(articles), _BATCH_SIZE):
            batch = articles[start : start + _BATCH_SIZE]
            try:
                items = _call_batch(batch)
            except Exception as exc:
                # One failed batch must not cost us the batches that succeeded.
                print(f"[summarizer] batch at {start} failed: {exc}")
                continue
            covered.update(article["id"] for article in batch)
            for item in items:
                if item.get("id"):
                    enriched[item["id"]] = item

    output = []
    for article in articles:
        detail = enriched.get(article["id"])
        if detail:
            output.append(
                {
                    **article,
                    "summary": (detail.get("summary") or "").strip()
                    or _fallback(article)["summary"],
                    "category": detail.get("category") or "Other",
                    "impact": (detail.get("impact") or "medium").lower(),
                }
            )
        elif article["id"] not in covered:
            output.append({**article, **_fallback(article)})
        # else: the editor saw it and said no, honour that.
    return output


@tool("Intelligent Summarizer Tool")
def summarizer_tool(articles_json: str) -> str:
    """Summarise a JSON array of articles from the News Fetcher Tool.

    Adds a 20-40 word summary, a category and an impact rating to every
    article, removing duplicates. Returns the enriched JSON array.
    """
    try:
        articles = json.loads(articles_json)
    except json.JSONDecodeError as exc:
        return json.dumps({"error": f"Expected a JSON array of articles: {exc}"})
    if not isinstance(articles, list):
        return json.dumps({"error": "Expected a JSON array of articles."})
    return json.dumps(summarise(articles), indent=2)
