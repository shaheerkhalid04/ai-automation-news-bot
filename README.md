# Dispatch

An autonomous newsdesk. A multi-agent crew finds the day's stories, edits them
into a briefing, posts it to Slack and files it to Google Sheets, every six
hours, without anyone pressing anything.

Live dashboard: **https://dispatch-newsdesk.vercel.app**

---

## What it does

```
  topics ──▶ Discover ──▶ Edit ──▶ Broadcast ──▶ Archive
             (search)    (Groq)    (Slack)      (Sheets)
```

Three agents, four tools, one sequential pass:

| Agent | Role | Tools |
|---|---|---|
| **Newsroom Scout** | Surfaces the last 24 hours across the configured beats | `NewsFetcherTool` |
| **Desk Editor** | Cuts duplicates, writes 30-45 word summaries, ranks by impact | `SummarizerTool` |
| **Wire Operator** | Publishes to Slack, appends to Sheets, reports what landed | `SlackBotTool`, `SheetsLoggerTool` |

Google Sheets is the system of record. The dashboard reads the same rows the
crew writes, so there is no second database to keep in sync.

## The two runners

The CrewAI dependency tree weighs about 670 MB installed, well past the 250 MB
ceiling on a Vercel serverless function. Rather than pretend otherwise, the
same four tools are driven by two runners:

| Runner | Runs on | What it is |
|---|---|---|
| **Agent runner** | Local, or GitHub Actions every 6h | The full CrewAI crew. Three agents reason over the tools and decide what survives the edit. |
| **Edge runner** | Vercel, cron every 6h | The same four tools in a fixed order. No agent reasoning, but it starts cold in under a second and fits the serverless budget. |

Both write to the same spreadsheet and post to the same Slack channel.

## Running it

```bash
npm install
cp .env.example .env.local
npm run dev
```

The dashboard comes up on `http://localhost:3000`. With no credentials at all
it still works: the news fetcher falls back to Google News RSS, which needs no
account, and the summariser falls back to article snippets.

For the agent crew:

```bash
pip install -r requirements.txt
python -m crew.main
```

Add `--direct` to run the four tools without the LLM orchestration layer.

## Configuration

Everything is optional. A missing credential disables that leg of the pipeline
rather than raising, so a half-configured deployment still produces a briefing.

| Variable | Needed for | Notes |
|---|---|---|
| `GROQ_API_KEY` | Real summaries | Without it the desk falls back to raw snippets |
| `GROQ_MODEL` | Summarising | Defaults to `llama-3.3-70b-versatile` |
| `CREW_AGENT_MODEL` | Agent reasoning | Defaults to `llama-3.1-8b-instant`, see below |
| `SERPER_API_KEY` | Richer search | Optional. Empty means the keyless Google News RSS backend |
| `SLACK_WEBHOOK_URL` | Slack delivery | Or `SLACK_BOT_TOKEN` + `SLACK_CHANNEL` |
| `GOOGLE_SHEETS_ID` | Archiving | The id from the spreadsheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Archiving | Share the sheet with this address as Editor |
| `GOOGLE_PRIVATE_KEY` | Archiving | Keep the `\n` escapes intact |
| `NEWS_TOPICS` | Beats | Comma separated. Defaults to AI, tech, finance, crypto |
| `MAX_ARTICLES` | Briefing size | Defaults to 12 |
| `CRON_SECRET` | Locking `/api/cron` | When set, the endpoint requires it |

## Living inside the Groq free tier

The free tier allows 12,000 tokens per minute and 100,000 per day, per model.
Three design decisions fall out of that, and they are the reason the crew runs
at all rather than dying on a 429:

- **The agents and the summariser use different models.** Orchestration chatter
  on `llama-3.1-8b-instant` leaves the whole daily allowance of the larger model
  for the briefing itself.
- **Articles never travel through the agents.** Tools hand data to each other
  through a shared run buffer (`crew/state.py`) and return a short receipt, so
  a twelve-story briefing costs a few hundred context tokens instead of tens of
  thousands. Passing the payloads as tool arguments hit a hard 413.
- **`max_tokens` is sized to the batch.** Groq counts it as *requested* tokens
  against the per-minute allowance, so an oversized ceiling gets a short reply
  rejected outright.

Every tool argument is a plain string for the same family of reasons: strict
tool-schema validation rejects a number sent as `"3"`, an array sent where a
string was declared, and a zero-argument tool whose schema has `required` with
no `properties`.

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/cron` | GET | Scheduled entrypoint, guarded by `CRON_SECRET` |
| `/api/run` | POST | Manual trigger from the dashboard |
| `/api/digests` | GET | Feed for the dashboard, read from Sheets |

## Automation

Two schedules, deliberately:

| Schedule | Cadence | Drives |
|---|---|---|
| `vercel.json` cron | Daily, 07:00 UTC | Edge runner |
| `.github/workflows/briefing.yml` | Every 6 hours | Agent crew |

Vercel's Hobby plan rejects any cron expression that fires more than once a
day, so the six-hourly cadence the brief calls for lives in GitHub Actions,
which has no such limit. The workflow can also be run by hand from the Actions
tab.

Because both schedules publish to the same channel, the pipeline fingerprints
every headline against column E of the spreadsheet before summarising. A story
already in the archive is dropped, so an overlapping run posts nothing and
costs no tokens rather than duplicating the briefing.

## Layout

```
crew/                 CrewAI package
  config/             agents.yaml, tasks.yaml
  tools/              the four custom tools
  newsroom.py         crew definition
  main.py             entrypoints
src/
  app/api/            cron, run, digests
  components/         dashboard, pipeline rail, story cards
  lib/tools/          the same four tools for the edge runner
design-system/        generated design tokens and rules
```
