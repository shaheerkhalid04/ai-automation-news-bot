"""Appends each digest to a Google Sheet.

The sheet doubles as the project's datastore: the web dashboard reads the same
rows back, so there is no second database to keep in sync. Auth uses a service
account, which must be granted Editor access on the target spreadsheet.
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

from crewai.tools import tool

from crew.settings import settings

_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
_TIMEOUT = 30

HEADERS = ["Date", "Topic", "Category", "Impact", "Headline", "Summary", "Source", "Source URL", "Run ID"]


def _access_token() -> str:
    """Exchange the service account key for an OAuth access token."""
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    credentials = service_account.Credentials.from_service_account_info(
        {
            "type": "service_account",
            "client_email": settings.sheets_client_email,
            "private_key": settings.sheets_private_key,
            "token_uri": "https://oauth2.googleapis.com/token",
        },
        scopes=[_SCOPE],
    )
    credentials.refresh(Request())
    return credentials.token


def _call(method: str, path: str, token: str, payload: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{_BASE}/{settings.sheets_id}{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=_TIMEOUT) as response:
        raw = response.read()
    return json.loads(raw) if raw else {}


def _ensure_tab(token: str) -> None:
    """Create the target tab and its header row the first time we log."""
    meta = _call("GET", "", token)
    existing = {
        sheet["properties"]["title"] for sheet in meta.get("sheets", [])
    }
    if settings.sheets_tab in existing:
        return

    _call(
        "POST",
        ":batchUpdate",
        token,
        {"requests": [{"addSheet": {"properties": {"title": settings.sheets_tab}}}]},
    )
    target = urllib.parse.quote(f"{settings.sheets_tab}!A1")
    _call(
        "PUT",
        f"/values/{target}?valueInputOption=RAW",
        token,
        {"values": [HEADERS]},
    )


def log_rows(items: list[dict[str, Any]], run_id: str = "") -> dict[str, Any]:
    if not items:
        return {"logged": 0, "reason": "nothing to log"}
    if not settings.sheets_enabled:
        return {"logged": 0, "reason": "Google Sheets is not configured"}

    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = [
        [
            stamp,
            item.get("topic", ""),
            item.get("category", ""),
            item.get("impact", ""),
            item.get("headline", ""),
            item.get("summary", ""),
            item.get("source", ""),
            item.get("url", ""),
            run_id,
        ]
        for item in items
    ]

    try:
        token = _access_token()
        _ensure_tab(token)
        target = urllib.parse.quote(f"{settings.sheets_tab}!A1")
        _call(
            "POST",
            f"/values/{target}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
            token,
            {"values": rows},
        )
        return {"logged": len(rows), "tab": settings.sheets_tab}
    except Exception as exc:
        return {"logged": 0, "reason": str(exc)}


def logged_fingerprints() -> set[str]:
    """Headline fingerprints already in the sheet.

    Two runners share this archive (the Vercel cron and this crew), so
    whichever fires second uses these to avoid refiling a published story.
    """
    if not settings.sheets_enabled:
        return set()

    try:
        token = _access_token()
        target = urllib.parse.quote(f"{settings.sheets_tab}!E2:E")
        body = _call("GET", f"/values/{target}", token)
        return {
            fingerprint(row[0])
            for row in body.get("values", [])
            if row and row[0]
        }
    except Exception as exc:
        # A read failure must not block publishing; worst case we repost.
        print(f"[sheets_logger] fingerprint read failed: {exc}")
        return set()


def fingerprint(headline: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", headline.lower())[:80]


@tool("Sheets Logger Tool")
def sheets_logger_tool(items_json: str, run_id: str = "") -> str:
    """Append the summarised digest to Google Sheets for record keeping.

    Writes one row per story with date, topic, category, impact, headline,
    summary, source and source URL.
    """
    try:
        items = json.loads(items_json)
    except json.JSONDecodeError as exc:
        return json.dumps({"logged": 0, "reason": f"invalid JSON: {exc}"})
    return json.dumps(log_rows(items if isinstance(items, list) else [], run_id))
