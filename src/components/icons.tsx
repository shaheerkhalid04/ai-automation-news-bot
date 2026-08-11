/* Inline stroke icons, sized by the parent's font-size. No icon dependency. */

type IconProps = { className?: string };

const base = "h-4 w-4 shrink-0";

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={`${base} ${className ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </Svg>
);

export const SlackIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="10" width="4" height="4" rx="2" />
    <rect x="10" y="3" width="4" height="4" rx="2" />
    <rect x="17" y="10" width="4" height="4" rx="2" />
    <rect x="10" y="17" width="4" height="4" rx="2" />
    <path d="M10 12h4M12 10v4" />
  </Svg>
);

export const SheetIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M4 9h16M4 15h16M10 9v12" />
  </Svg>
);

export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 12 5 5L20 6" />
  </Svg>
);

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 14 9 5 9-5" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-14-4l-2 2" />
    <path d="M4 13a8 8 0 0 0 14 4l2-2" />
    <path d="M4 5v4h4M20 19v-4h-4" />
  </Svg>
);
