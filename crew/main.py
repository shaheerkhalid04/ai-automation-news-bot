"""Entrypoints for the newsroom.

`python -m crew.main` runs the full CrewAI crew, with the agents reasoning
about which stories survive. `python -m crew.main --direct` runs the same four
tools in a fixed order without the LLM orchestration layer, which is what the
scheduled job uses when it only needs a deterministic, fast pass.
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from datetime import datetime, timezone

from crew.settings import settings
from crew.tools import (
    fetch_news,
    fingerprint,
    log_rows,
    logged_fingerprints,
    publish,
    summarise,
)


def _run_id() -> str:
    return f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:6]}"


def run_direct(per_topic: int = 6) -> dict:
    """Deterministic pipeline: fetch, summarise, publish, log."""
    run_id = _run_id()
    started = datetime.now(timezone.utc)

    articles = fetch_news(settings.topics, per_topic=per_topic)
    print(f"[dispatch] fetched {len(articles)} articles via {settings.search_backend}")

    # Drop anything the archive already holds before spending tokens on it.
    already_filed = logged_fingerprints()
    fresh = [
        article
        for article in articles
        if fingerprint(article["headline"]) not in already_filed
    ]
    if len(fresh) < len(articles):
        print(f"[dispatch] skipped {len(articles) - len(fresh)} already in the archive")

    items = summarise(fresh)
    # Rank so the briefing leads with what matters.
    order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda item: order.get(item.get("impact", "medium"), 1))
    items = items[: settings.max_articles]
    print(f"[dispatch] editorial pass kept {len(items)} stories")

    slack = publish(items)
    print(f"[dispatch] slack: {slack}")

    sheets = log_rows(items, run_id=run_id)
    print(f"[dispatch] sheets: {sheets}")

    return {
        "run_id": run_id,
        "started_at": started.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "fetched": len(articles),
        "published": len(items),
        "slack": slack,
        "sheets": sheets,
        "items": items,
    }


def run_crew(per_topic: int = 6) -> str:
    """Full CrewAI orchestration with the three agents."""
    from crew.newsroom import NewsroomCrew

    if not settings.llm_enabled:
        raise SystemExit(
            "GROQ_API_KEY is required for the agent crew. "
            "Use --direct to run the tools without the LLM layer."
        )

    result = NewsroomCrew().crew().kickoff(
        inputs={
            "topics": ", ".join(settings.topics),
            "per_topic": per_topic,
            "max_articles": settings.max_articles,
            "run_id": _run_id(),
        }
    )
    return str(result)


def main() -> int:
    parser = argparse.ArgumentParser(prog="dispatch", description="Run the newsroom.")
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Skip agent orchestration and run the tools in a fixed order.",
    )
    parser.add_argument("--per-topic", type=int, default=6, help="Articles per topic.")
    parser.add_argument("--json", action="store_true", help="Print the result as JSON.")
    args = parser.parse_args()

    print(f"[dispatch] topics: {', '.join(settings.topics)}")
    print(
        f"[dispatch] search={settings.search_backend} "
        f"llm={'groq' if settings.llm_enabled else 'off'} "
        f"slack={'on' if settings.slack_enabled else 'off'} "
        f"sheets={'on' if settings.sheets_enabled else 'off'}"
    )

    if args.direct:
        result = run_direct(per_topic=args.per_topic)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"\n[dispatch] run {result['run_id']} published {result['published']} stories")
        return 0

    print(run_crew(per_topic=args.per_topic))
    return 0


if __name__ == "__main__":
    sys.exit(main())
