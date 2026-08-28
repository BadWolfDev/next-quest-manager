import { cn } from "@/lib/utils";

/**
 * The NQM mark: three stacked bars standing in for kanban columns, cut by a
 * quest chevron. Inline SVG so it themes with `currentColor`.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-7", className)}
    >
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="8.5"
        className="fill-primary"
      />
      <rect x="7" y="8" width="4.5" height="16" rx="2.25" fill="white" opacity="0.95" />
      <rect x="13.75" y="8" width="4.5" height="11" rx="2.25" fill="white" opacity="0.7" />
      <rect x="20.5" y="8" width="4.5" height="7" rx="2.25" fill="white" opacity="0.45" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <Logo />
      <span className="text-[0.95rem]">
        Next<span className="text-primary">Quest</span>
      </span>
    </span>
  );
}
