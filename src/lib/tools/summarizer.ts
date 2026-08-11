import { config } from "../config";
import type { Article, Impact, Story } from "../types";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM = `You are the desk editor for a newsroom briefing.
For each article you receive, write one tight summary of 30-45 words that says
what actually happened and why a reader should care. No preamble, no hedging,
no repeating the headline verbatim.

Also assign:
- "category": one of AI, Tech, Finance, Crypto, Policy, Science, Other
- "impact": one of high, medium, low

Drop any article that duplicates a story already in your output.
Respond with JSON only, shaped as:
{"items":[{"id":"<the id you were given>","summary":"...","category":"...","impact":"..."}]}`;

interface Enriched {
  id: string;
  summary?: string;
  category?: string;
  impact?: string;
}

/** Models occasionally wrap JSON in prose or a fenced block. */
function extractJson(content: string): { items?: Enriched[] } {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const span = text.match(/\{[\s\S]*\}/);
    if (!span) throw new Error("no JSON object in model response");
    return JSON.parse(span[0]);
  }
}

function fallbackSummary(article: Article): string {
  const snippet = (article.snippet || article.headline).trim();
  if (snippet.length <= 240) return snippet;
  return `${snippet.slice(0, 237).replace(/\s+\S*$/, "")}...`;
}

function normaliseImpact(value: string | undefined): Impact {
  const lowered = (value ?? "").toLowerCase();
  return lowered === "high" || lowered === "low" ? lowered : "medium";
}

async function callGroq(articles: Article[]): Promise<Map<string, Enriched>> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.groqModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify(
            articles.map(({ id, headline, source, snippet }) => ({
              id,
              headline,
              source,
              snippet,
            })),
          ),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq responded ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const parsed = extractJson(body.choices[0].message.content);

  const map = new Map<string, Enriched>();
  for (const item of parsed.items ?? []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

/**
 * Attach a summary, category and impact to each article. A missing key or a
 * bad model response degrades to the article snippet instead of failing.
 */
export async function summarise(articles: Article[]): Promise<Story[]> {
  if (articles.length === 0) return [];

  let enriched = new Map<string, Enriched>();
  if (config.llmEnabled) {
    try {
      enriched = await callGroq(articles);
    } catch (error) {
      console.error("[summarizer] Groq call failed, using snippets:", error);
    }
  }

  return articles.map((article) => {
    const detail = enriched.get(article.id);
    return {
      ...article,
      summary: detail?.summary?.trim() || fallbackSummary(article),
      category: detail?.category || "Other",
      impact: normaliseImpact(detail?.impact),
    };
  });
}
