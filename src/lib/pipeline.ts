import { randomUUID } from "node:crypto";
import { config } from "./config";
import { fetchNews } from "./tools/news-fetcher";
import { summarise } from "./tools/summarizer";
import { publishToSlack } from "./tools/slack";
import { fingerprint, loggedFingerprints, logToSheets } from "./tools/sheets";
import type { Article, RunResult, Story } from "./types";

const IMPACT_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Best-effort recent-run cache. Serverless instances are recycled, so this is
 * a convenience for the dashboard only; Google Sheets remains the record.
 */
const recentRuns: RunResult[] = [];

export function getRecentRuns(): RunResult[] {
  return recentRuns;
}

function runId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  return `${stamp}-${randomUUID().slice(0, 6)}`;
}

function rank(stories: Story[]): Story[] {
  return [...stories]
    .sort((a, b) => (IMPACT_ORDER[a.impact] ?? 1) - (IMPACT_ORDER[b.impact] ?? 1))
    .slice(0, config.maxArticles);
}

/**
 * The four tools in a fixed order: fetch, summarise, publish, log.
 * Distribution failures are recorded rather than thrown, so a broken Slack
 * webhook never costs us the Sheets record.
 */
export async function runPipeline(perTopic = 6): Promise<RunResult> {
  const id = runId();
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const articles = await fetchNews(config.topics, perTopic);

  // Drop anything the archive already holds before spending tokens on it.
  const alreadyFiled = await loggedFingerprints();
  const fresh: Article[] = articles.filter(
    (article) => !alreadyFiled.has(fingerprint(article.headline)),
  );

  const summarised = await summarise(fresh);
  const stories = rank(summarised);

  const [slack, sheets] = await Promise.all([
    publishToSlack(stories),
    logToSheets(stories, id),
  ]);

  const finished = Date.now();
  const result: RunResult = {
    runId: id,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    searchBackend: config.searchBackend,
    fetched: articles.length,
    skipped: articles.length - fresh.length,
    published: stories.length,
    slack,
    sheets,
    stories,
  };

  recentRuns.unshift(result);
  recentRuns.splice(10);
  return result;
}
