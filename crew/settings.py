"""Runtime configuration, read once from the environment.

Every integration is optional. A missing credential disables that leg of the
pipeline rather than raising, so a partially configured deployment still
produces a digest instead of a stack trace.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

try:  # local development convenience; absent in production images
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


DEFAULT_TOPICS = [
    "artificial intelligence",
    "technology",
    "finance",
    "cryptocurrency",
]


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _topics() -> list[str]:
    raw = _env("NEWS_TOPICS")
    if not raw:
        return list(DEFAULT_TOPICS)
    return [topic.strip() for topic in raw.split(",") if topic.strip()]


@dataclass(frozen=True)
class Settings:
    groq_api_key: str = field(default_factory=lambda: _env("GROQ_API_KEY"))
    groq_model: str = field(
        default_factory=lambda: _env("GROQ_MODEL", "llama-3.3-70b-versatile")
    )
    serper_api_key: str = field(default_factory=lambda: _env("SERPER_API_KEY"))
    slack_webhook_url: str = field(default_factory=lambda: _env("SLACK_WEBHOOK_URL"))
    slack_bot_token: str = field(default_factory=lambda: _env("SLACK_BOT_TOKEN"))
    slack_channel: str = field(default_factory=lambda: _env("SLACK_CHANNEL"))
    sheets_id: str = field(default_factory=lambda: _env("GOOGLE_SHEETS_ID"))
    sheets_client_email: str = field(
        default_factory=lambda: _env("GOOGLE_SERVICE_ACCOUNT_EMAIL")
    )
    sheets_private_key: str = field(
        default_factory=lambda: _env("GOOGLE_PRIVATE_KEY").replace("\\n", "\n")
    )
    sheets_tab: str = field(default_factory=lambda: _env("GOOGLE_SHEETS_TAB", "Digest"))
    topics: list[str] = field(default_factory=_topics)
    max_articles: int = field(
        default_factory=lambda: int(_env("MAX_ARTICLES", "12") or 12)
    )

    @property
    def search_backend(self) -> str:
        return "serper" if self.serper_api_key else "google-news-rss"

    @property
    def slack_enabled(self) -> bool:
        return bool(self.slack_webhook_url or (self.slack_bot_token and self.slack_channel))

    @property
    def sheets_enabled(self) -> bool:
        return bool(self.sheets_id and self.sheets_client_email and self.sheets_private_key)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.groq_api_key)


settings = Settings()
