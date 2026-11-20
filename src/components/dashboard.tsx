"use client";

import { useCallback, useEffect, useState } from "react";
import { PipelineRail } from "./pipeline-rail";
import { StatusPanel } from "./status-panel";
import { StoryCard } from "./story-card";
import { BoltIcon, RefreshIcon } from "./icons";
import type { IntegrationStatus, RunResult, Story } from "@/lib/types";

interface FeedPayload {
  stories: Story[];
  runs: RunResult[];
  status: IntegrationStatus;
  origin: "sheets" | "memory" | "preview";
}

const ORIGIN_COPY: Record<FeedPayload["origin"], string> = {
  sheets: "Filed to Google Sheets",
  memory: "Last run on this instance",
  preview: "Live wire preview, not yet filed",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[--border] bg-[--surface]/60 px-3 py-2.5 backdrop-blur-sm">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-[--foreground-subtle]">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-[--foreground]">
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-[--foreground-subtle]">{hint}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[--border] bg-[--surface]/40 p-4">
      <div className="h-3 w-16 animate-pulse rounded bg-[--secondary]" />
      <div className="mt-3 h-4 w-11/12 animate-pulse rounded bg-[--secondary]" />
      <div className="mt-2 h-4 w-3/5 animate-pulse rounded bg-[--secondary]" />
      <div className="mt-3 h-3 w-full animate-pulse rounded bg-[--secondary]/60" />
      <div className="mt-1.5 h-3 w-4/5 animate-pulse rounded bg-[--secondary]/60" />
    </div>
  );
}

const TOKEN_KEY = "dispatch-run-token";

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Dashboard() {
  const [data, setData] = useState<FeedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  // Runs need the CRON_SECRET; the owner pastes it once and it stays in this browser.
  const [askToken, setAskToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/digests", { cache: "no-store" });
      if (!response.ok) throw new Error(`feed responded ${response.status}`);
      setData(await response.json());
    } catch (error) {
      setNotice({
        tone: "warn",
        text: error instanceof Error ? error.message : "could not load the feed",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trigger = useCallback(async () => {
    setRunning(true);
    setNotice(null);
    try {
      const token = readToken();
      const response = await fetch("/api/run", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const result = await response.json();
      if (response.status === 401) {
        setAskToken(true);
        throw new Error(token ? "That run token was refused" : "Runs need the owner's run token");
      }
      if (!response.ok) throw new Error(result.error ?? "the run failed");

      // Nothing new is a healthy outcome, not a failure: the archive already
      // held every story on the wire, so both channels correctly stayed quiet.
      if (result.published === 0 && result.skipped > 0) {
        setNotice({
          tone: "ok",
          text: `Nothing new on the wire · all ${result.skipped} stories were already filed`,
        });
      } else {
        const parts = [`${result.published} stories filed`];
        parts.push(result.slack.ok ? "Slack delivered" : `Slack ${result.slack.detail}`);
        parts.push(result.sheets.ok ? "Sheets logged" : `Sheets ${result.sheets.detail}`);
        setNotice({
          tone: result.slack.ok && result.sheets.ok ? "ok" : "warn",
          text: parts.join(" · "),
        });
      }
      await load();
    } catch (error) {
      setNotice({
        tone: "warn",
        text: error instanceof Error ? error.message : "the run failed",
      });
    } finally {
      setRunning(false);
    }
  }, [load]);

  const status = data?.status;
  const stories = data?.stories ?? [];
  const lastRun = data?.runs[0];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[--accent]/12 text-[--accent] ring-1 ring-inset ring-[--accent]/25">
            <BoltIcon className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="text-[19px] font-semibold leading-none tracking-tight text-[--foreground]">
              Dispatch
            </h1>
            <p className="mt-1 text-[12px] text-[--foreground-subtle]">
              Autonomous newsdesk · a crew that files itself
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-[--border-strong] bg-[--surface] px-2.5 py-1 text-[11.5px] text-[--foreground-muted] sm:flex">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                running ? "bg-[--warning]" : "bg-[--accent]"
              }`}
            />
            {running ? "Run in progress" : "Scheduler armed · every 6h"}
          </span>

          <button
            type="button"
            onClick={trigger}
            disabled={running}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[--accent] px-3.5 py-2 text-[13px] font-semibold text-[#04140a] transition-all duration-200 hover:bg-[--accent-dim] disabled:cursor-not-allowed disabled:opacity-55"
          >
            <RefreshIcon className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Filing…" : "Run now"}
          </button>
        </div>
      </header>

      {askToken && (
        <form
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[--border] bg-[--surface]/60 px-3 py-2 text-[12.5px]"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              localStorage.setItem(TOKEN_KEY, tokenDraft.trim());
            } catch {
              // Storage blocked: the token simply is not remembered.
            }
            setAskToken(false);
            setTokenDraft("");
            void trigger();
          }}
        >
          <label htmlFor="run-token" className="text-[--foreground-muted]">
            Run token
          </label>
          <input
            id="run-token"
            type="password"
            autoComplete="off"
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            placeholder="CRON_SECRET"
            className="min-w-0 flex-1 rounded-md border border-[--border-strong] bg-transparent px-2.5 py-1.5 text-[--foreground]"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-md border border-[--border-strong] px-3 py-1.5 text-[--foreground]"
          >
            Save and run
          </button>
        </form>
      )}

      {notice && (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-3 py-2 text-[12.5px] ${
            notice.tone === "ok"
              ? "border-[--accent]/25 bg-[--accent]/8 text-[--accent]"
              : "border-[--warning]/25 bg-[--warning]/8 text-[--warning]"
          }`}
        >
          {notice.text}
        </div>
      )}

      {status && (
        <div className="mb-4 space-y-3">
          <PipelineRail status={status} running={running} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="In the briefing"
              value={String(stories.length)}
              hint={data ? ORIGIN_COPY[data.origin] : undefined}
            />
            <Stat
              label="Last run"
              value={lastRun ? `${(lastRun.durationMs / 1000).toFixed(1)}s` : "n/a"}
              hint={lastRun ? `${lastRun.fetched} articles scanned` : "no run on this instance"}
            />
            <Stat
              label="Search"
              value={status.search.keyless ? "RSS" : "Serper"}
              hint={status.search.keyless ? "keyless backend" : "serper.dev"}
            />
            <Stat
              label="Channels"
              value={`${Number(status.slack.enabled) + Number(status.sheets.enabled)}/2`}
              hint="Slack · Sheets"
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <main>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[--foreground-subtle]">
              The briefing
            </h2>
            {data && (
              <span className="text-[11px] text-[--foreground-subtle]">
                {ORIGIN_COPY[data.origin]}
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : stories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[--border-strong] bg-[--surface]/40 px-6 py-14 text-center">
              <p className="text-[14px] font-medium text-[--foreground]">
                Nothing on the wire yet
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-[--foreground-subtle]">
                The crew has not filed a briefing on this instance. Trigger a run from the
                header, or wait for the six-hourly scheduler to pick it up.
              </p>
              <button
                type="button"
                onClick={trigger}
                disabled={running}
                className="mt-4 cursor-pointer rounded-lg border border-[--border-strong] bg-[--surface-raised] px-3.5 py-2 text-[13px] font-medium text-[--foreground] transition-colors duration-200 hover:border-[--accent]/40 hover:text-[--accent] disabled:opacity-55"
              >
                Run the crew now
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {stories.map((story, index) => (
                <StoryCard key={`${story.id}-${index}`} story={story} index={index} />
              ))}
            </div>
          )}
        </main>

        <aside>
          {status && <StatusPanel status={status} runs={data?.runs ?? []} />}
        </aside>
      </div>

      <footer className="mt-8 border-t border-[--border] pt-4 text-[11.5px] text-[--foreground-subtle]">
        Dispatch runs a three-agent crew over four tools: discover, edit, broadcast, archive.
        Every briefing is appended to Google Sheets, which is the system of record.
      </footer>
    </div>
  );
}
