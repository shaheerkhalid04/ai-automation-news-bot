import { NextResponse } from "next/server";
import { config, integrationStatus } from "@/lib/config";
import { getRecentRuns } from "@/lib/pipeline";
import { readFromSheets } from "@/lib/tools/sheets";
import { fetchNews } from "@/lib/tools/news-fetcher";
import type { Story } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Feed the dashboard. Google Sheets is the record of what was published, so we
 * read it first. Before the first run has landed we show live headlines
 * instead of an empty board, flagged as a preview so nothing looks published
 * that was not.
 */
export async function GET() {
  const status = integrationStatus();
  const runs = getRecentRuns();

  let stories: Story[] = [];
  let origin: "sheets" | "memory" | "preview" = "memory";

  if (config.sheetsEnabled) {
    stories = await readFromSheets();
    if (stories.length > 0) origin = "sheets";
  }

  if (stories.length === 0 && runs.length > 0) {
    stories = runs[0].stories;
    origin = "memory";
  }

  if (stories.length === 0) {
    const articles = await fetchNews(status.topics.slice(0, 2), 4);
    stories = articles.slice(0, 8).map((article) => ({
      ...article,
      summary: article.snippet || article.headline,
      category: "Other",
      impact: "medium" as const,
    }));
    origin = "preview";
  }

  return NextResponse.json({ stories, runs, status, origin });
}
