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

from crew import state
from crew.settings import settings

_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
_TIMEOUT = 60
_BATCH_SIZE = 10
_MAX_RETRIES = 2

_SYSTEM = """You are the desk editor for a newsroom briefing.

For each article write 25 to 40 words, one or two full sentences. Say what
happened and what follows from it for someone on this beat. A one-line
restatement of the headline is a failure. Count your words.

This is the right length and shape:
{"id":"x1","summary":"Regulators opened a formal review of how the largest cloud providers bundle AI services with existing contracts. If it finds tying, enterprise buyers could gain the right to unpick deals they signed years ago.","category":"Policy","impact":"high"}

When a snippet is provided, use it. It carries the detail the headline leaves
out, and your summary should show that you read it. When there is no snippet,
explain what the headline means for the beat, and never invent specifics you
were not given: no numbers, dates, names or quotes absent from the input.

Also assign:
- "category": one of AI, Tech, Finance, Crypto, Policy, Science, Other
- "impact": one of high, medium, low

Never introduce the consequence with a stock phrase. "This matters as it" and
"This is significant because" are banned openings for the second sentence; make
the consequence part of the sentence instead, and vary how you get there.

Drop an entry, by omitting it, only when it is not an article at all: stock
quote and ticker pages, index or price listings, directory pages, promotional
or referral and discount code posts, and pages carrying a company name with no
event attached. A real but minor story is kept
and rated "low", never dropped. Also drop an entry covering the same event as
one you already wrote up, keeping the stronger one. Return one entry for every
article you keep, reusing the id you were given.

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
            # Without an explicit agent, urllib sends "Python-urllib/3.x" and
            # the edge in front of the API answers 403 before Groq sees it.
            "User-Agent": "Dispatch/1.0 (+newsdesk automation)",
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
def summarizer_tool(max_stories: str) -> str:
    """Summarise the articles the News Fetcher Tool just collected.

    Reads what the fetcher held, writes a 20-40 word summary plus a category
    and impact rating for each, drops duplicates, and ranks high impact first.
    The result is held for the publishing tools.

    max_stories caps the briefing and is required: pass it as a plain string
    such as "12", or "" to use the configured default. Returns a short receipt.
    """
    articles = state.get_articles()
    if not articles:
        return "Nothing to summarise. Run the News Fetcher Tool first."

    # Accept whatever shape the model produced: "12", " 12 ", or nothing.
    try:
        cap = int(str(max_stories).strip())
    except (TypeError, ValueError):
        cap = settings.max_articles
    if cap < 1:
        cap = settings.max_articles

    stories = summarise(articles)

    order = {"high": 0, "medium": 1, "low": 2}
    stories.sort(key=lambda story: order.get(story.get("impact", "medium"), 1))
    stories = stories[:cap]
    state.set_stories(stories)

    dropped = len(articles) - len(stories)
    listing = "\n".join(
        f"{index}. [{story['impact']}/{story['category']}] {story['headline']}\n   {story['summary']}"
        for index, story in enumerate(stories, start=1)
    )
    return (
        f"Edited {len(articles)} articles down to {len(stories)} "
        f"({dropped} dropped as duplicates or over the cap), held for publishing.\n{listing}"
    )
