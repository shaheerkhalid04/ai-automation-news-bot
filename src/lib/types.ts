export type Impact = "high" | "medium" | "low";

export interface Article {
  id: string;
  headline: string;
  url: string;
  source: string;
  publishedAt: string;
  snippet: string;
  topic: string;
}

export interface Story extends Article {
  summary: string;
  category: string;
  impact: Impact;
}

export interface ChannelResult {
  ok: boolean;
  detail: string;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  searchBackend: string;
  fetched: number;
  /** Articles dropped because the archive already held them. */
  skipped: number;
  published: number;
  slack: ChannelResult;
  sheets: ChannelResult;
  stories: Story[];
}

export interface IntegrationStatus {
  search: { backend: string; keyless: boolean };
  llm: { enabled: boolean; model: string };
  slack: { enabled: boolean; transport: string };
  sheets: { enabled: boolean };
  topics: string[];
  maxArticles: number;
  schedule: string;
}
