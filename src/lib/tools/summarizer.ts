import { config } from "../config";
import { REASONING_HEADROOM, reasoningParams } from "../groq";
import type { Article, Impact, Story } from "../types";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM = `You are the desk editor for a newsroom briefing.

For each article write 25 to 40 words, one or two full sentences. Say what
happened and what follows from it for someone on this beat. A one-line
restatement of the headline is a failure. Count your words.

This is the right length and shape:
{"id":"x1","summary":"Regulators opened a formal review of how the largest cloud providers bundle AI services with existing contracts. If it finds tying, enterprise buyers could gain the right to unpick deals they signed years ago.","category":"Policy","impact":"high"}

When a snippet is provided, use it. It carries the detail the headline leaves
out, and your summary should show that you read it. When there is no snippet,
explain what the headline means for the beat, and never invent specifics you
were not given: no numbers, dates, names or quotes absent from the input.

Also assign:
- "category": one of AI, Tech, Finance, Crypto, Policy, Science, Other
- "impact": one of high, medium, low

Never introduce the consequence with a stock phrase. "This matters as it" and
"This is significant because" are banned openings for the second sentence; make
the consequence part of the sentence instead, and vary how you get there.

Drop an entry, by omitting it, only when it is not an article at all: stock
quote and ticker pages, index or price listings, directory pages, promotional
or referral and discount code posts, and pages carrying a company name with no
event attached. A real but minor story is kept
and rated "low", never dropped. Also drop an entry covering the same event as
one you already wrote up, keeping the stronger one. Return one entry for every
article you keep, reusing the id you were given.

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

/** Articles per request. Keeps each call well inside the free-tier budget. */
const BATCH_SIZE = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Groq counts max_tokens against the tokens-per-minute allowance as *requested*
 * tokens, so an oversized ceiling gets the whole call rejected with a 429 even
 * when the reply would have been short. Reserve only what a batch can plausibly
 * produce: roughly 60 tokens of JSON per story, plus a little slack.
 */
function tokenCeiling(count: number): number {
  // A reasoning model spends part of max_tokens thinking before it answers.
  const headroom = reasoningParams(config.groqModel).reasoning_effort ? REASONING_HEADROOM : 0;
  return Math.min(4000, count * 110 + 400) + headroom;
}

async function callBatch(articles: Article[], attempt = 0): Promise<Enriched[]> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.groqModel,
      temperature: 0.2,
      max_tokens: tokenCeiling(articles.length),
      ...reasoningParams(config.groqModel),
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

  if (response.status === 429 && attempt < 2) {
    const detail = await response.text();
    // The error body tells us how long to wait; honour it rather than guessing.
    const suggested = Number(detail.match(/try again in ([\d.]+)s/)?.[1]);
    const waitMs = Math.min(
      20_000,
      Number.isFinite(suggested) ? suggested * 1000 + 500 : 6000,
    );
    console.warn(`[summarizer] rate limited, retrying in ${Math.round(waitMs / 100) / 10}s`);
    await sleep(waitMs);
    return callBatch(articles, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`Groq responded ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return extractJson(body.choices[0].message.content).items ?? [];
}

interface EditorPass {
  /** Entries the editor wrote, by article id. */
  enriched: Map<string, Enriched>;
  /**
   * Ids the editor actually got to look at. An id here but absent from
   * `enriched` was deliberately dropped as a duplicate; an id missing from
   * both belongs to a batch that errored and still deserves a fallback.
   */
  covered: Set<string>;
}

/**
 * Summarise in sequential batches. Sequential rather than parallel because the
 * free tier's limit is per minute across the whole org, so firing every batch
 * at once just guarantees the later ones are rejected.
 */
async function callGroq(articles: Article[]): Promise<EditorPass> {
  const enriched = new Map<string, Enriched>();
  const covered = new Set<string>();

  for (let start = 0; start < articles.length; start += BATCH_SIZE) {
    const batch = articles.slice(start, start + BATCH_SIZE);
    try {
      const items = await callBatch(batch);
      for (const article of batch) covered.add(article.id);
      for (const item of items) {
        if (item?.id) enriched.set(item.id, item);
      }
    } catch (error) {
      // One failed batch must not cost us the batches that did succeed.
      console.error(`[summarizer] batch at ${start} failed:`, error);
    }
  }

  return { enriched, covered };
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

  let pass: EditorPass = { enriched: new Map(), covered: new Set() };
  if (config.llmEnabled) {
    pass = await callGroq(articles);
  }

  const fallback = (article: Article): Story => ({
    ...article,
    summary: fallbackSummary(article),
    category: "Other",
    impact: "medium",
  });

  return articles.flatMap((article) => {
    const detail = pass.enriched.get(article.id);
    if (detail) {
      return [
        {
          ...article,
          summary: detail.summary?.trim() || fallbackSummary(article),
          category: detail.category || "Other",
          impact: normaliseImpact(detail.impact),
        },
      ];
    }
    // The editor saw it and said no: that is an editorial decision, honour it.
    if (pass.covered.has(article.id)) return [];
    // Nobody looked at it, so keep it rather than lose it to an outage.
    return [fallback(article)];
  });
}
