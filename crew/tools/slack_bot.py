"""Publishes the finished digest to Slack.

Supports both delivery routes: an incoming webhook (one URL, fixed channel)
and a bot token via chat.postMessage. The webhook wins when both are set
because it needs no scope negotiation.
"""

from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from typing import Any

from crewai.tools import tool

from crew import state
from crew.settings import settings

_TIMEOUT = 20
_IMPACT_MARK = {"high": "▲", "medium": "▪", "low": "▫"}
_SLACK_BLOCK_LIMIT = 48  # Slack rejects payloads over 50 blocks


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_blocks(items: list[dict[str, Any]], intro: str = "") -> list[dict[str, Any]]:
    stamp = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"Dispatch Briefing - {len(items)} stories"},
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"Generated {stamp}"}],
        },
    ]
    if intro:
        blocks.append(
            {"type": "section", "text": {"type": "mrkdwn", "text": f"_{_escape(intro)}_"}}
        )
    blocks.append({"type": "divider"})

    for item in items:
        mark = _IMPACT_MARK.get(item.get("impact", "medium"), "▪")
        headline = _escape(item["headline"])
        summary = _escape(item.get("summary", ""))
        meta = " · ".join(
            part for part in [item.get("category"), item.get("source")] if part
        )
        blocks.append(
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"{mark} *<{item['url']}|{headline}>*\n{summary}",
                },
            }
        )
        if meta:
            blocks.append(
                {"type": "context", "elements": [{"type": "mrkdwn", "text": _escape(meta)}]}
            )
        if len(blocks) >= _SLACK_BLOCK_LIMIT:
            break

    return blocks


def _post(url: str, payload: dict[str, Any], headers: dict[str, str]) -> str:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            **headers,
            "Content-Type": "application/json",
            "User-Agent": "Dispatch/1.0 (+newsdesk automation)",
        },
    )
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
        return response.read().decode()


def publish(items: list[dict[str, Any]], intro: str = "") -> dict[str, Any]:
    if not items:
        return {"delivered": False, "reason": "nothing to publish"}
    if not settings.slack_enabled:
        return {"delivered": False, "reason": "Slack is not configured"}

    blocks = build_blocks(items, intro)
    fallback = f"Dispatch Briefing - {len(items)} stories"

    try:
        if settings.slack_webhook_url:
            _post(settings.slack_webhook_url, {"text": fallback, "blocks": blocks}, {})
            return {"delivered": True, "transport": "webhook", "stories": len(items)}

        raw = _post(
            "https://slack.com/api/chat.postMessage",
            {"channel": settings.slack_channel, "text": fallback, "blocks": blocks},
            {"Authorization": f"Bearer {settings.slack_bot_token}"},
        )
        body = json.loads(raw)
        if not body.get("ok"):
            return {"delivered": False, "reason": body.get("error", "unknown Slack error")}
        return {"delivered": True, "transport": "bot", "stories": len(items)}
    except Exception as exc:
        return {"delivered": False, "reason": str(exc)}


@tool("Slack Bot Tool")
def slack_bot_tool(intro: str) -> str:
    """Post the edited briefing to Slack as headline, summary and link.

    Publishes whatever the Intelligent Summarizer Tool produced.

    intro is required: a one-line note shown above the briefing, for example
    "Quiet morning, three stories worth your time", or "" for no note.
    Returns whether delivery succeeded, and why if it did not.
    """
    stories = state.get_stories()
    if not stories:
        return "Nothing to publish. Run the Intelligent Summarizer Tool first."

    result = publish(stories, intro=str(intro).strip())
    if result.get("delivered"):
        return f"Delivered {result['stories']} stories to Slack via {result['transport']}."
    return f"Slack delivery did not happen: {result.get('reason', 'unknown')}."
