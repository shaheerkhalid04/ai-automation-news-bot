"""Shared buffer for one crew run.

The agents orchestrate the pipeline; they do not need to carry it. Passing full
article payloads through tool arguments cost us twice: every payload was billed
against Groq's 12k tokens-per-minute allowance, and models emit JSON arrays and
bare numbers where a strict tool schema expects strings, so Groq rejected the
calls before they ever arrived.

Tools therefore hand data to each other through this buffer and return only a
short human-readable receipt. The crew still decides what runs, in what order,
and what to do when a channel fails, which is the part worth orchestrating.
"""

from __future__ import annotations

import threading
from typing import Any

_lock = threading.Lock()
_articles: list[dict[str, Any]] = []
_stories: list[dict[str, Any]] = []


def set_articles(articles: list[dict[str, Any]]) -> None:
    with _lock:
        _articles.clear()
        _articles.extend(articles)


def get_articles() -> list[dict[str, Any]]:
    with _lock:
        return list(_articles)


def set_stories(stories: list[dict[str, Any]]) -> None:
    with _lock:
        _stories.clear()
        _stories.extend(stories)


def get_stories() -> list[dict[str, Any]]:
    with _lock:
        return list(_stories)


def reset() -> None:
    """Clear the buffer so one run never inherits another's leftovers."""
    with _lock:
        _articles.clear()
        _stories.clear()
