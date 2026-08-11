import { config } from "../config";
import type { ChannelResult, Story } from "../types";

const IMPACT_MARK: Record<string, string> = { high: "▲", medium: "▪", low: "▫" };
const BLOCK_LIMIT = 48; // Slack rejects payloads over 50 blocks

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildBlocks(stories: Story[]): unknown[] {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Dispatch Briefing - ${stories.length} stories` },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Generated ${stamp} UTC` }],
    },
    { type: "divider" },
  ];

  for (const story of stories) {
    const mark = IMPACT_MARK[story.impact] ?? "▪";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${mark} *<${story.url}|${escape(story.headline)}>*\n${escape(story.summary)}`,
      },
    });

    const meta = [story.category, story.source].filter(Boolean).join(" · ");
    if (meta) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: escape(meta) }],
      });
    }
    if (blocks.length >= BLOCK_LIMIT) break;
  }

  return blocks;
}

/** Post the briefing to Slack via webhook, or chat.postMessage as a fallback. */
export async function publishToSlack(stories: Story[]): Promise<ChannelResult> {
  if (stories.length === 0) return { ok: false, detail: "nothing to publish" };
  if (!config.slackEnabled) return { ok: false, detail: "not configured" };

  const payload = {
    text: `Dispatch Briefing - ${stories.length} stories`,
    blocks: buildBlocks(stories),
  };

  try {
    if (config.slackWebhookUrl) {
      const response = await fetch(config.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok || text !== "ok") {
        return { ok: false, detail: text || `HTTP ${response.status}` };
      }
      return { ok: true, detail: `${stories.length} stories via webhook` };
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.slackBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: config.slackChannel, ...payload }),
    });
    const body = (await response.json()) as { ok: boolean; error?: string };
    if (!body.ok) return { ok: false, detail: body.error ?? "unknown Slack error" };
    return { ok: true, detail: `${stories.length} stories via bot` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
