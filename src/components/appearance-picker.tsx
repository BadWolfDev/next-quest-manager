"use client";

import { Check } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
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
 * Skin preference lives in localStorage and on the <html> attribute — there is
 * no React state that owns it, because the inline head script sets it before
 * React exists. `useSyncExternalStore` reads the DOM as the source of truth so
 * the picker can never disagree with what is on screen.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() {
  for (const cb of listeners) cb();
}

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

export function AppearancePicker() {
  const mounted = useMounted();
  const skin = useSyncExternalStore(subscribe, readSkin, () => "default" as Skin);
  const scanlines = useSyncExternalStore(subscribe, readScanlines, () => true);

  const onPick = useCallback((next: Skin) => applySkin(next), []);

  return (
    <div className="px-2 py-1.5">
      <p className="text-muted-foreground mb-2 text-xs font-medium">Appearance</p>

      <div className="grid grid-cols-2 gap-1.5">
        {SKINS.map((value) => {
          const meta = SKIN_META[value];
          const selected = mounted && skin === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(value)}
              aria-pressed={selected}
              title={meta.blurb}
              className={cn(
                "focus-visible:ring-ring/60 flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2",
                selected
                  ? "border-primary/60 bg-accent"
                  : "hover:bg-accent/60 border-transparent",
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-4 shrink-0 overflow-hidden rounded-[3px] border"
              >
                {meta.swatch.map((c) => (
                  <span key={c} style={{ background: c }} className="flex-1" />
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {meta.label}
              </span>
              {selected ? <Check className="size-3 shrink-0" /> : null}
            </button>
          );
        })}
      </div>

      {/* Light/dark only means anything on the default skin: the three skins are
          self-contained dark palettes that override it by specificity. */}
      {mounted && skin === "default" ? (
        <div className="mt-2.5 flex items-center justify-between">
          <span className="text-sm">Light / dark</span>
          <ThemeToggle />
        </div>
      ) : null}

      {mounted && skin !== "default" ? (
        <label className="mt-2.5 flex cursor-pointer items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-sm">Scanlines</span>
            <span className="text-muted-foreground block text-xs">
              CRT overlay
            </span>
          </span>
          <input
            type="checkbox"
            checked={scanlines}
            onChange={(e) => applyScanlines(e.target.checked)}
            className="accent-primary size-4 shrink-0"
          />
        </label>
      ) : null}
    </div>
  );
}
