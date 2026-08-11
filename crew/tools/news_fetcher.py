"""News discovery tool.

Talks to whichever search backend is configured. Serper gives richer
metadata and is used when a key is present; otherwise we fall back to the
Google News RSS endpoint, which needs no credentials at all. That fallback
is what keeps a fresh clone useful before anyone has signed up for anything.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

from crewai.tools import tool

from crew import state
from crew.settings import settings

_USER_AGENT = "Dispatch/1.0 (+newsdesk automation)"
_TIMEOUT = 20


def _http(url: str, *, data: bytes | None = None, headers: dict | None = None) -> bytes:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    request.add_header("User-Agent", _USER_AGENT)
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
        return response.read()


def _decode_entities(text: str) -> str:
    for entity, char in (
        ("&nbsp;", " "),
        ("&quot;", '"'),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&amp;", "&"),  # last, so it cannot revive an earlier entity
    ):
        text = text.replace(entity, char)
    return text


def _strip_html(value: str) -> str:
    """Google News double-escapes markup inside <description>, so one pass
    leaves literal tags and a second-level entity like "&amp;nbsp;" behind.
    Two full strip-and-decode rounds clear both layers.
    """
    text = value or ""
    for _ in range(2):
        text = _decode_entities(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()


def _article_id(url: str, headline: str) -> str:
    return hashlib.sha1(f"{url}|{headline}".encode()).hexdigest()[:12]


def _from_serper(topic: str, limit: int) -> list[dict[str, Any]]:
    payload = json.dumps({"q": topic, "num": limit, "tbs": "qdr:d"}).encode()
    raw = _http(
        "https://google.serper.dev/news",
        data=payload,
        headers={
            "X-API-KEY": settings.serper_api_key,
            "Content-Type": "application/json",
        },
    )
    body = json.loads(raw)
    articles = []
    for item in body.get("news", [])[:limit]:
        link = item.get("link", "")
        headline = _strip_html(item.get("title", ""))
        if not link or not headline:
            continue
        articles.append(
            {
                "id": _article_id(link, headline),
                "headline": headline,
                "url": link,
                "source": item.get("source") or "Unknown",
                "published_at": item.get("date") or "",
                "snippet": _strip_html(item.get("snippet", "")),
                "topic": topic,
            }
        )
    return articles


def _from_google_news_rss(topic: str, limit: int) -> list[dict[str, Any]]:
    query = urllib.parse.quote(topic)
    url = (
        f"https://news.google.com/rss/search?q={query}+when:1d"
        "&hl=en-US&gl=US&ceid=US:en"
    )
    root = ET.fromstring(_http(url))
    articles = []
    for item in root.findall("./channel/item")[:limit]:
        link = (item.findtext("link") or "").strip()
        headline = _strip_html(item.findtext("title") or "")
        if not link or not headline:
            continue
        # Google appends " - Publisher" to RSS titles. Strip it whether or not
        # the <source> tag also gave us the publisher name.
        source = _strip_html(item.findtext("source") or "")
        if source and headline.endswith(f" - {source}"):
            headline = headline[: -(len(source) + 3)]
        elif not source and " - " in headline:
            headline, _, source = headline.rpartition(" - ")
        articles.append(
            {
                "id": _article_id(link, headline),
                "headline": headline.strip(),
                "url": link,
                "source": source or "Google News",
                "published_at": (item.findtext("pubDate") or "").strip(),
                "snippet": _useful_snippet(
                    _strip_html(item.findtext("description") or "")[:400], headline
                ),
                "topic": topic,
            }
        )
    return articles


def fetch_news(topics: list[str], per_topic: int = 6) -> list[dict[str, Any]]:
    """Collect fresh articles for each topic, de-duplicated across topics."""
    backend = _from_serper if settings.serper_api_key else _from_google_news_rss
    collected: list[dict[str, Any]] = []
    seen: set[str] = set()

    for topic in topics:
        try:
            articles = backend(topic, per_topic)
        except Exception as exc:  # a dead topic should not kill the whole run
            print(f"[news_fetcher] '{topic}' failed via {backend.__name__}: {exc}")
            continue

        for article in articles:
            # Same story syndicated under several topics: keep the first hit.
            fingerprint = _normalise(article["headline"])
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            article["fetched_at"] = datetime.now(timezone.utc).isoformat()
            collected.append(article)

    return collected


def _normalise(headline: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", headline.lower())[:80]


def _useful_snippet(snippet: str, headline: str) -> str:
    """Google News fills <description> with the headline and publisher again,
    which tells the summariser nothing. Drop it so the model works from the
    headline rather than being fed a duplicate.
    """
    if _normalise(snippet).startswith(_normalise(headline)[:40]):
        return ""
    return snippet


# How many articles the crew pulls per beat. Deliberately not a tool argument:
# models emit numbers as strings ("3") often enough that Groq's strict tool
# schema validation rejects the call outright, and a fixed depth costs the crew
# nothing it actually needs to decide.
_CREW_PER_TOPIC = 3


@tool("News Fetcher Tool")
def news_fetcher_tool(topics: str) -> str:
    """Fetch today's trending articles for a comma-separated list of beats.

    Pass the beats as one comma-separated string, for example
    "artificial intelligence, finance". The articles are held for the
    summariser, so you do not need to copy them anywhere. Returns a short
    receipt listing what was found.
    """
    parsed = [topic.strip() for topic in topics.split(",") if topic.strip()]
    if not parsed:
        parsed = settings.topics

    articles = fetch_news(parsed, per_topic=_CREW_PER_TOPIC)
    state.set_articles(articles)

    if not articles:
        return "No articles found. The search backend returned nothing for these beats."

    # Headlines only: enough for the desk to reason about coverage, without
    # putting URLs and snippets through the context window.
    listing = "\n".join(
        f"{index}. [{article['topic']}] {article['headline']} ({article['source']})"
        for index, article in enumerate(articles, start=1)
    )
    return (
        f"Fetched {len(articles)} articles across {len(parsed)} beats via "
        f"{settings.search_backend}, held for the summariser.\n{listing}"
    )
