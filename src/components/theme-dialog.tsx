"use client";

import { Check } from "lucide-react";
import { useCallback, useRef, useSyncExternalStore } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMounted } from "@/hooks/use-mounted";
import {
  isSkin,
  SCANLINES_STORAGE_KEY,
  SKIN_META,
  SKIN_STORAGE_KEY,
  SKINS,
  type Skin,
} from "@/lib/skin";
import { cn } from "@/lib/utils";

/**
 * Skin preference lives in localStorage and on the <html> attribute — the
 * inline head script sets it before React exists, so the DOM is the source of
 * truth and `useSyncExternalStore` reads from it. That keeps the picker from
 * ever disagreeing with what is on screen.
 */
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const emit = () => {
  for (const cb of listeners) cb();
};

function readSkin(): Skin {
  if (typeof document === "undefined") return "default";
  const attr = document.documentElement.getAttribute("data-theme");
  return isSkin(attr) ? attr : "default";
}
function readScanlines(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.getAttribute("data-scanlines") === "on";
}

function applySkin(skin: Skin) {
  const root = document.documentElement;
  if (skin === "default") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", skin);
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, skin);
  } catch {
    /* storage blocked — the attribute still applies for this session */
  }
  emit();
}

function applyScanlines(on: boolean) {
  const root = document.documentElement;
  if (on) root.setAttribute("data-scanlines", "on");
  else root.removeAttribute("data-scanlines");
  try {
    localStorage.setItem(SCANLINES_STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* as above */
  }
  emit();
}

/**
 * A small board mock painted from the theme's own tokens.
 *
 * `data-preview-theme` re-scopes that skin's token block onto this subtree (see
 * globals.css), so each card shows the real background, field pattern, surface,
 * border weight and shadow recipe — not an approximation.
 */
function ThemePreview({ skin }: { skin: Skin }) {
  return (
    <span
      data-preview-theme={skin}
      aria-hidden="true"
      className="nqm-theme-preview flex h-[68px] w-full items-start gap-1.5 overflow-hidden rounded-md border p-2"
    >
      {[3, 2, 1].map((cards, column) => (
        <span
          key={column}
          className="nqm-theme-preview-column flex flex-1 flex-col gap-1 rounded-[3px] p-1"
        >
          <span className="nqm-theme-preview-accent mb-0.5 block h-1 w-4 rounded-full opacity-80" />
          {Array.from({ length: cards }).map((_, card) => (
            <span
              key={card}
              className="nqm-theme-preview-card block h-2.5 w-full rounded-[3px]"
            />
          ))}
        </span>
      ))}
    </span>
  );
}

export function ThemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mounted = useMounted();
  const skin = useSyncExternalStore(subscribe, readSkin, () => "default" as Skin);
  const scanlines = useSyncExternalStore(subscribe, readScanlines, () => true);

  // Re-theming restyles this subtree in place; nothing remounts, so the button
  // the user just pressed keeps focus. The refs let arrow keys move focus with
  // radiogroup semantics.
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const next =
        (index + (forward ? 1 : -1) + SKINS.length) % SKINS.length;
      const target = cardRefs.current[next];
      target?.focus();
      applySkin(SKINS[next]);
    },
    [],
  );

  const isDefault = !mounted || skin === "default";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Theme</DialogTitle>
          <DialogDescription>
            Applies instantly and is remembered on this device.
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="Theme"
          className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2"
        >
          {SKINS.map((value, index) => {
            const meta = SKIN_META[value];
            const selected = mounted && skin === value;
            return (
              <button
                key={value}
                ref={(el) => {
                  cardRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                // Roving tabindex: one stop for the whole group.
                tabIndex={selected || (!mounted && index === 0) ? 0 : -1}
                onClick={() => applySkin(value)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "focus-visible:ring-ring group relative flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2",
                  selected
                    ? "border-primary ring-primary/40 ring-2"
                    : "hover:border-foreground/30 hover:bg-accent/40",
                )}
              >
                <ThemePreview skin={value} />

                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    {/* Full names, never truncated — the point of this dialog. */}
                    <span className="block text-sm font-medium">
                      {meta.label}
                    </span>
                    <span className="text-muted-foreground block text-xs leading-snug">
                      {meta.blurb}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "bg-primary text-primary-foreground mt-0.5 grid size-4 shrink-0 place-items-center rounded-full transition-opacity",
                      selected ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <Check className="size-3" />
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/*
          Light/dark only means anything on the default theme — the three skins
          are self-contained dark palettes that override it by specificity.
          Scanlines are the mirror image: only meaningful on a skin.
        */}
        {isDefault ? (
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Light / dark</span>
              <span className="text-muted-foreground block text-xs">
                Follow the system, or pick one
              </span>
            </span>
            <ThemeToggle />
          </div>
        ) : (
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 border-t pt-4">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Scanlines</span>
              <span className="text-muted-foreground block text-xs">
                CRT overlay
              </span>
            </span>
            <input
              type="checkbox"
              checked={scanlines}
              onChange={(event) => applyScanlines(event.target.checked)}
              className="accent-primary size-4 shrink-0"
            />
          </label>
        )}
      </DialogContent>
    </Dialog>
  );
}
