import { config } from "../config";
import type { Article, Impact, Story } from "../types";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM = `You are the desk editor for a newsroom briefing.
For each article, write one tight summary of 20-40 words saying what happened
and why a reader should care. No preamble, no hedging, and never just restate
the headline.

You will often have only a headline and a publisher, with no article body. When
that is all you have, explain what the headline means and why it matters to
someone following this beat. Never invent specifics you were not given: no
numbers, dates, names or quotes that are not in the input.

Also assign:
- "category": one of AI, Tech, Finance, Crypto, Policy, Science, Other
- "impact": one of high, medium, low

Keep every article unless it covers the same event as one you have already
written up, in which case keep only the stronger one. Return one entry for
every article you keep, reusing the id you were given.

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
      // Enough headroom for a full briefing; the default truncates the array
      // partway through and silently costs us stories.
      max_tokens: 8000,
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
 * Attach a summary, category and impact to each article.
 *
 * When the editor returns entries, its omissions are decisions: an article it
 * left out was a duplicate, so it is dropped rather than back-filled with its
 * own headline. Only when the editor produced nothing at all (no key, or a
 * failed call) does every article fall through to its snippet.
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

  if (enriched.size === 0) {
    return articles.map((article) => ({
      ...article,
      summary: fallbackSummary(article),
      category: "Other",
      impact: "medium" as const,
    }));
  }

  return articles.flatMap((article) => {
    const detail = enriched.get(article.id);
    if (!detail) return [];
    return [
      {
        ...article,
        summary: detail.summary?.trim() || fallbackSummary(article),
        category: detail.category || "Other",
        impact: normaliseImpact(detail.impact),
      },
    ];
  });
}
