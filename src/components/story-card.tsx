import { LinkIcon } from "./icons";
import type { Story } from "@/lib/types";

const IMPACT_STYLE: Record<string, { chip: string; bar: string; label: string }> = {
  high: {
    chip: "bg-[--accent]/12 text-[--accent] ring-[--accent]/25",
    bar: "bg-[--accent]",
    label: "High impact",
  },
  medium: {
    chip: "bg-[--info]/10 text-[--info] ring-[--info]/20",
    bar: "bg-[--info]/70",
    label: "Medium impact",
  },
  low: {
    chip: "bg-[--secondary] text-[--foreground-subtle] ring-[--border-strong]",
    bar: "bg-[--border-strong]",
    label: "Low impact",
  },
};

/**
 * Google News hands back redirect URLs, so every card would otherwise read
 * "news.google.com". Fall back to the beat when the host tells us nothing.
 */
function provenance(story: Story): string {
  try {
    const host = new URL(story.url).hostname.replace(/^www\./, "");
    return host.endsWith("news.google.com") ? story.topic : host;
  } catch {
    return story.topic;
  }
}

export function StoryCard({ story, index }: { story: Story; index: number }) {
  const impact = IMPACT_STYLE[story.impact] ?? IMPACT_STYLE.medium;

  return (
    <article
      className="rise group relative overflow-hidden rounded-xl border border-[--border] bg-[--surface]/70 transition-colors duration-200 hover:border-[--border-strong] hover:bg-[--surface-raised]/80"
      style={{ animationDelay: `${Math.min(index * 45, 540)}ms` }}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 h-full w-[2px] ${impact.bar}`}
      />

      <div className="p-4 pl-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${impact.chip}`}
          >
            {story.category}
          </span>
          <span className="sr-only">{impact.label}</span>
          {story.source && (
            <span className="text-[11px] text-[--foreground-subtle]">{story.source}</span>
          )}
        </div>

        <h3 className="text-[15px] font-semibold leading-snug text-[--foreground]">
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer decoration-[--accent]/40 underline-offset-4 transition-colors hover:text-[--accent] hover:underline"
          >
            {story.headline}
          </a>
        </h3>

        <p className="mt-2 text-[13px] leading-relaxed text-[--foreground-muted]">
          {story.summary}
        </p>

        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[--foreground-subtle]">
          <LinkIcon className="h-3 w-3" />
          <span className="truncate">{provenance(story)}</span>
        </div>
      </div>
    </article>
  );
}
