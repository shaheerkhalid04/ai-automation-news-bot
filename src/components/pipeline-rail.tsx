"use client";

import { SearchIcon, SparkIcon, SlackIcon, SheetIcon } from "./icons";
import type { IntegrationStatus } from "@/lib/types";

type Stage = {
  key: string;
  label: string;
  tool: string;
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
  live: boolean;
};

function stages(status: IntegrationStatus): Stage[] {
  return [
    {
      key: "fetch",
      label: "Discover",
      tool: "NewsFetcherTool",
      icon: SearchIcon,
      detail: status.search.keyless ? "Google News RSS" : "Serper.dev",
      live: true,
    },
    {
      key: "summarise",
      label: "Edit",
      tool: "SummarizerTool",
      icon: SparkIcon,
      detail: status.llm.enabled ? status.llm.model : "snippet fallback",
      live: status.llm.enabled,
    },
    {
      key: "slack",
      label: "Broadcast",
      tool: "SlackBotTool",
      icon: SlackIcon,
      detail: status.slack.enabled ? `${status.slack.transport} delivery` : "awaiting webhook",
      live: status.slack.enabled,
    },
    {
      key: "sheets",
      label: "Archive",
      tool: "SheetsLoggerTool",
      icon: SheetIcon,
      detail: status.sheets.enabled ? "Google Sheets" : "awaiting service account",
      live: status.sheets.enabled,
    },
  ];
}

export function PipelineRail({
  status,
  running,
}: {
  status: IntegrationStatus;
  running: boolean;
}) {
  const items = stages(status);

  return (
    <section
      aria-label="Pipeline stages"
      className="rounded-xl border border-[--border] bg-[--surface]/60 p-4 backdrop-blur-sm sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[--foreground-subtle]">
          Crew pipeline
        </h2>
        <span className="text-[11px] tabular-nums text-[--foreground-subtle]">
          sequential · 3 agents · 4 tools
        </span>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-center lg:gap-0">
        {items.map((stage, index) => (
          <li key={stage.key} className="contents">
            <div
              className={`group relative rounded-lg border p-3 transition-colors duration-200 ${
                stage.live
                  ? "border-[--border-strong] bg-[--surface-raised]"
                  : "border-dashed border-[--border] bg-[--surface-raised]/40"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    stage.live
                      ? "bg-[--accent]/12 text-[--accent]"
                      : "bg-[--secondary] text-[--foreground-subtle]"
                  } ${running && stage.live ? "pulse-ring" : ""}`}
                >
                  <stage.icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight text-[--foreground]">
                    {stage.label}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-[--foreground-subtle]">
                    {stage.tool}
                  </p>
                  <p
                    className={`mt-1.5 truncate text-[11.5px] ${
                      stage.live ? "text-[--foreground-muted]" : "text-[--warning]"
                    }`}
                  >
                    {stage.detail}
                  </p>
                </div>
              </div>
            </div>

            {index < items.length - 1 && (
              <div
                aria-hidden="true"
                className={`hidden h-px w-6 lg:block ${
                  running ? "flow-line" : "bg-[--border-strong]"
                }`}
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
