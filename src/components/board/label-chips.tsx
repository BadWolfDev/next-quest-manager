"use client";

import { cn } from "@/lib/utils";

export type ChipLabel = { id: string; name: string; color: string };

/**
 * Label chips on a card face.
 *
 * Colour comes from the label itself, so the chip has to stay legible against
 * whatever the skin's card surface is. `color-mix` tints the label colour into
 * a translucent fill and keeps the text in the full-strength colour, which
 * works on the light default and on all three dark skins without per-skin
 * overrides. Radius is inherited, so the skins' global radius-0 rule applies.
 */
export function LabelChips({
  labels,
  className,
}: {
  labels: ChipLabel[];
  className?: string;
}) {
  if (labels.length === 0) return null;

  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {labels.map((label) => (
        <span
          key={label.id}
          className="inline-flex max-w-full items-center truncate rounded-[4px] border px-1.5 py-0.5 text-[0.65rem] font-medium leading-4"
          style={{
            background: `color-mix(in oklab, ${label.color} 20%, transparent)`,
            borderColor: `color-mix(in oklab, ${label.color} 55%, transparent)`,
            color: label.color,
          }}
        >
          {label.name || "Label"}
        </span>
      ))}
    </span>
  );
}
