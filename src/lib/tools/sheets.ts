import { createSign } from "node:crypto";
import { config } from "../config";
import type { ChannelResult, Impact, Story } from "../types";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export const HEADERS = [
  "Date",
  "Topic",
  "Category",
  "Impact",
  "Headline",
  "Summary",
  "Source",
  "Source URL",
  "Run ID",
];

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint a service-account access token. Signing the JWT with node:crypto keeps
 * this dependency-free, which matters for serverless cold starts.
 */
async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.sheetsClientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(config.sheetsPrivateKey));
  const assertion = `${header}.${claims}.${signature}`;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) {
    throw new Error(body.error_description ?? "could not mint an access token");
  }
  return body.access_token;
}

async function call<T>(
  method: string,
  path: string,
  token: string,
  payload?: unknown,
): Promise<T> {
  const response = await fetch(`${BASE}/${config.sheetsId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Sheets API ${response.status}: ${await response.text()}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Create the target tab and its header row the first time we log. */
async function ensureTab(token: string): Promise<void> {
  const meta = await call<{ sheets?: Array<{ properties: { title: string } }> }>(
    "GET",
    "",
    token,
  );
  const existing = new Set((meta.sheets ?? []).map((sheet) => sheet.properties.title));
  if (existing.has(config.sheetsTab)) return;

  await call("POST", ":batchUpdate", token, {
    requests: [{ addSheet: { properties: { title: config.sheetsTab } } }],
  });
  await call(
    "PUT",
    `/values/${encodeURIComponent(`${config.sheetsTab}!A1`)}?valueInputOption=RAW`,
    token,
    { values: [HEADERS] },
  );
}

export async function logToSheets(stories: Story[], runId: string): Promise<ChannelResult> {
  if (stories.length === 0) return { ok: false, detail: "nothing to log" };
  if (!config.sheetsEnabled) return { ok: false, detail: "not configured" };

  const stamp = new Date().toISOString();
  const values = stories.map((story) => [
    stamp,
    story.topic,
    story.category,
    story.impact,
    story.headline,
    story.summary,
    story.source,
    story.url,
    runId,
  ]);

  try {
    const token = await accessToken();
    await ensureTab(token);
    await call(
      "POST",
      `/values/${encodeURIComponent(`${config.sheetsTab}!A1`)}:append` +
        `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      token,
      { values },
    );
    return { ok: true, detail: `${values.length} rows appended` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Read the digest back out of the sheet. The spreadsheet is the datastore, so
 * the dashboard and the crew never disagree about what was published.
 */
export async function readFromSheets(limit = 60): Promise<Story[]> {
  if (!config.sheetsEnabled) return [];

  try {
    const token = await accessToken();
    const range = encodeURIComponent(`${config.sheetsTab}!A2:I`);
    const body = await call<{ values?: string[][] }>(
      "GET",
      `/values/${range}`,
      token,
    );
    const rows = body.values ?? [];

    return rows
      .slice(-limit)
      .reverse()
      .map((row, index) => {
        const [date, topic, category, impact, headline, summary, source, url, runId] = row;
        return {
          id: `${runId || "row"}-${index}`,
          headline: headline ?? "",
          url: url ?? "",
          source: source ?? "",
          publishedAt: date ?? "",
          snippet: "",
          topic: topic ?? "",
          summary: summary ?? "",
          category: category ?? "Other",
          impact: (["high", "medium", "low"].includes(impact) ? impact : "medium") as Impact,
        };
      })
      .filter((story) => story.headline);
  } catch (error) {
    console.error("[sheets] read failed:", error);
    return [];
  }
}
