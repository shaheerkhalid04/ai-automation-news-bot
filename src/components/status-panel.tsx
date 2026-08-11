import { CheckIcon, MinusIcon, ClockIcon, LayersIcon } from "./icons";
import type { IntegrationStatus, RunResult } from "@/lib/types";

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="flex items-center gap-2 text-[13px] text-[--foreground-muted]">
        <span
          className={`flex h-4 w-4 items-center justify-center rounded-full ${
            ok ? "bg-[--accent]/15 text-[--accent]" : "bg-[--secondary] text-[--foreground-subtle]"
          }`}
        >
          {ok ? <CheckIcon className="h-2.5 w-2.5" /> : <MinusIcon className="h-2.5 w-2.5" />}
        </span>
        {label}
      </span>
      <span
        className={`truncate text-right font-mono text-[11px] ${
          ok ? "text-[--foreground-muted]" : "text-[--warning]"
        }`}
      >
        {value}
      </span>
    </li>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[--border] bg-[--surface]/60 p-4 backdrop-blur-sm">
      <h2 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[--foreground-subtle]">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StatusPanel({
  status,
  runs,
}: {
  status: IntegrationStatus;
  runs: RunResult[];
}) {
  return (
    <div className="space-y-3">
      <Panel title="Integrations" icon={LayersIcon}>
        <ul className="divide-y divide-[--border]">
          <Row
            label="Search"
            value={status.search.keyless ? "google-news-rss" : "serper"}
            ok
          />
          <Row
            label="Summariser"
            value={status.llm.enabled ? status.llm.model : "no GROQ_API_KEY"}
            ok={status.llm.enabled}
          />
          <Row
            label="Slack"
            value={status.slack.enabled ? status.slack.transport : "no webhook"}
            ok={status.slack.enabled}
          />
          <Row
            label="Sheets"
            value={status.sheets.enabled ? "connected" : "no service account"}
            ok={status.sheets.enabled}
          />
        </ul>
      </Panel>

      <Panel title="Beat" icon={LayersIcon}>
        <ul className="flex flex-wrap gap-1.5">
          {status.topics.map((topic) => (
            <li
              key={topic}
              className="rounded-md border border-[--border-strong] bg-[--surface-raised] px-2 py-1 text-[11.5px] text-[--foreground-muted]"
            >
              {topic}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] text-[--foreground-subtle]">
          Capped at {status.maxArticles} stories per briefing · {status.schedule.toLowerCase()}
        </p>
      </Panel>

      <Panel title="Recent runs" icon={ClockIcon}>
        {runs.length === 0 ? (
          <p className="py-1 text-[12.5px] text-[--foreground-subtle]">
            No run recorded on this instance yet. The scheduler fires every six hours, or
            trigger one now from the header.
          </p>
        ) : (
          <ol className="space-y-2">
            {runs.slice(0, 5).map((run) => (
              <li
                key={run.runId}
                className="rounded-lg border border-[--border] bg-[--surface-raised]/60 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[--foreground-muted]">
                    {run.runId.slice(0, 15)}
                  </span>
                  <span className="tabular-nums text-[11px] text-[--foreground-subtle]">
                    {(run.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[--foreground-subtle]">
                  <span>{run.fetched} found</span>
                  <span className="text-[--foreground-muted]">{run.published} filed</span>
                  <span className={run.slack.ok ? "text-[--accent]" : "text-[--warning]"}>
                    slack {run.slack.ok ? "ok" : "skipped"}
                  </span>
                  <span className={run.sheets.ok ? "text-[--accent]" : "text-[--warning]"}>
                    sheets {run.sheets.ok ? "ok" : "skipped"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
