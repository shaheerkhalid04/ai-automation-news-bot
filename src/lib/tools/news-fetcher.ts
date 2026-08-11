import { createHash } from "node:crypto";
import { config } from "../config";
import type { Article } from "../types";

const UA = "Dispatch/1.0 (+newsdesk automation)";

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // last, so it cannot revive an earlier entity
}

/**
 * Google News double-escapes markup inside <description>, so one pass leaves
 * literal tags and a second-level entity like "&amp;nbsp;" behind. Two full
 * strip-and-decode rounds clear both layers.
 */
function stripHtml(value: string): string {
  let text = value ?? "";
  for (let pass = 0; pass < 2; pass += 1) {
    text = decodeEntities(text.replace(/<[^>]+>/g, " "));
  }
  return text.replace(/\s+/g, " ").trim();
}

function articleId(url: string, headline: string): string {
  return createHash("sha1").update(`${url}|${headline}`).digest("hex").slice(0, 12);
}

function fingerprint(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
}

/**
 * Google News fills <description> with the headline and publisher again, which
 * tells the summariser nothing. Drop it so the model works from the headline
 * rather than being fed a duplicate.
 */
function usefulSnippet(snippet: string, headline: string): string {
  const a = fingerprint(snippet);
  const b = fingerprint(headline);
  return a.startsWith(b.slice(0, 40)) ? "" : snippet;
}

/** Pull the contents of a single XML tag out of a chunk of markup. */
function tag(xml: string, name: string): string {
  const match = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
  );
  if (!match) return "";
  return stripHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

async function fromSerper(topic: string, limit: number): Promise<Article[]> {
  const response = await fetch("https://google.serper.dev/news", {
    method: "POST",
    headers: {
      "X-API-KEY": config.serperApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: topic, num: limit, tbs: "qdr:d" }),
  });
  if (!response.ok) throw new Error(`Serper responded ${response.status}`);

  const body = (await response.json()) as {
    news?: Array<Record<string, string>>;
  };

  return (body.news ?? []).slice(0, limit).flatMap((item) => {
    const url = item.link ?? "";
    const headline = stripHtml(item.title ?? "");
    if (!url || !headline) return [];
    return [
      {
        id: articleId(url, headline),
        headline,
        url,
        source: item.source || "Unknown",
        publishedAt: item.date || "",
        snippet: stripHtml(item.snippet ?? ""),
        topic,
      },
    ];
  });
}

async function fromGoogleNewsRss(topic: string, limit: number): Promise<Article[]> {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}+when:1d` +
    `&hl=en-US&gl=US&ceid=US:en`;
  const response = await fetch(url, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`Google News responded ${response.status}`);

  const xml = await response.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items.slice(0, limit).flatMap((chunk) => {
    const link = tag(chunk, "link");
    let headline = tag(chunk, "title");
    if (!link || !headline) return [];

    // Google appends " - Publisher" to RSS titles. Strip it whether or not the
    // <source> tag also gave us the publisher name.
    let source = tag(chunk, "source");
    if (source && headline.endsWith(` - ${source}`)) {
      headline = headline.slice(0, -(source.length + 3));
    } else if (!source && headline.includes(" - ")) {
      const cut = headline.lastIndexOf(" - ");
      source = headline.slice(cut + 3);
      headline = headline.slice(0, cut);
    }

    return [
      {
        id: articleId(link, headline),
        headline: headline.trim(),
        url: link,
        source: source || "Google News",
        publishedAt: tag(chunk, "pubDate"),
        snippet: usefulSnippet(tag(chunk, "description").slice(0, 400), headline),
        topic,
      },
    ];
  });
}

/**
 * Collect fresh articles for every topic, de-duplicated across topics.
 * Topics are fetched in parallel; one failing topic never sinks the run.
 */
export async function fetchNews(topics: string[], perTopic = 6): Promise<Article[]> {
  const backend = config.serperApiKey ? fromSerper : fromGoogleNewsRss;

  const batches = await Promise.all(
    topics.map(async (topic) => {
      try {
        return await backend(topic, perTopic);
      } catch (error) {
        console.error(`[news-fetcher] "${topic}" failed:`, error);
        return [] as Article[];
      }
    }),
  );

  const seen = new Set<string>();
  const collected: Article[] = [];
  for (const article of batches.flat()) {
    const key = fingerprint(article.headline);
    if (seen.has(key)) continue;
    seen.add(key);
    collected.push(article);
  }
  return collected;
}
