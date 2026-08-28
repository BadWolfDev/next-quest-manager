"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Three-state segmented control.
 *
 * `useTheme()` reads localStorage in its state initialiser, so on the first
 * client render it already knows the stored theme while the server rendered
 * nothing. Selecting a button from that value directly produces a hydration
 * mismatch on `aria-checked` and `className`.
 *
 * So until `mounted` flips we render the exact same three buttons at the exact
 * same size with no selection at all — `aria-checked="false"` everywhere and no
 * highlight — which is what the server emits. The controls are disabled for
 * that first paint so nobody can click a button whose state is not yet known.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border bg-muted/60 p-0.5",
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            disabled={!mounted}
            onClick={() => setTheme(value)}
            className={cn(
              "grid size-7 place-items-center rounded-full transition-colors",
              "focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
