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

from crew.settings import settings

_TIMEOUT = 20
_IMPACT_MARK = {"high": "▲", "medium": "▪", "low": "▫"}
_SLACK_BLOCK_LIMIT = 48  # Slack rejects payloads over 50 blocks


def _escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_blocks(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
        {"type": "divider"},
    ]

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
        url, data=json.dumps(payload).encode(), headers={**headers, "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
        return response.read().decode()


def publish(items: list[dict[str, Any]]) -> dict[str, Any]:
    if not items:
        return {"delivered": False, "reason": "nothing to publish"}
    if not settings.slack_enabled:
        return {"delivered": False, "reason": "Slack is not configured"}

    blocks = build_blocks(items)
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
def slack_bot_tool(items_json: str) -> str:
    """Post a summarised digest to Slack as headline, summary and link.

    Takes the JSON array produced by the Intelligent Summarizer Tool.
    """
    try:
        items = json.loads(items_json)
    except json.JSONDecodeError as exc:
        return json.dumps({"delivered": False, "reason": f"invalid JSON: {exc}"})
    return json.dumps(publish(items if isinstance(items, list) else []))
