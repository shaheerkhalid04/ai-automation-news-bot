import type { IntegrationStatus } from "./types";

const DEFAULT_TOPICS = [
  "artificial intelligence",
  "technology",
  "finance",
  "cryptocurrency",
];

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  get groqApiKey() {
    return env("GROQ_API_KEY");
  },
  get groqModel() {
    return env("GROQ_MODEL", "llama-3.3-70b-versatile");
  },
  get serperApiKey() {
    return env("SERPER_API_KEY");
  },
  get slackWebhookUrl() {
    return env("SLACK_WEBHOOK_URL");
  },
  get slackBotToken() {
    return env("SLACK_BOT_TOKEN");
  },
  get slackChannel() {
    return env("SLACK_CHANNEL");
  },
  get sheetsId() {
    return env("GOOGLE_SHEETS_ID");
  },
  get sheetsClientEmail() {
    return env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  },
  get sheetsPrivateKey() {
    // Vercel stores the newlines escaped; restore them before signing.
    return env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  },
  get sheetsTab() {
    return env("GOOGLE_SHEETS_TAB", "Digest");
  },
  get cronSecret() {
    return env("CRON_SECRET");
  },
  get topics(): string[] {
    const raw = env("NEWS_TOPICS");
    if (!raw) return [...DEFAULT_TOPICS];
    return raw
      .split(",")
      .map((topic) => topic.trim())
      .filter(Boolean);
  },
  get maxArticles(): number {
    const parsed = Number.parseInt(env("MAX_ARTICLES", "12"), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
  },
  get searchBackend(): string {
    return this.serperApiKey ? "serper" : "google-news-rss";
  },
  get llmEnabled(): boolean {
    return Boolean(this.groqApiKey);
  },
  get slackEnabled(): boolean {
    return Boolean(this.slackWebhookUrl || (this.slackBotToken && this.slackChannel));
  },
  get sheetsEnabled(): boolean {
    return Boolean(this.sheetsId && this.sheetsClientEmail && this.sheetsPrivateKey);
  },
};

export function integrationStatus(): IntegrationStatus {
  return {
    search: { backend: config.searchBackend, keyless: !config.serperApiKey },
    llm: { enabled: config.llmEnabled, model: config.groqModel },
    slack: {
      enabled: config.slackEnabled,
      transport: config.slackWebhookUrl ? "webhook" : config.slackBotToken ? "bot" : "none",
    },
    sheets: { enabled: config.sheetsEnabled },
    topics: config.topics,
    maxArticles: config.maxArticles,
    schedule: "Every 6 hours",
  };
}
