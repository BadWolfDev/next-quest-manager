/** Shared, non-server constants (a "use server" module may only export actions). */

export const ACCENTS = [
  "violet",
  "blue",
  "emerald",
  "amber",
  "rose",
  "slate",
] as const;

export type Accent = (typeof ACCENTS)[number];

/** Board background presets offered in the create-board dialog. */
export const BOARD_BACKGROUNDS = [
  { label: "Indigo", value: "#6366f1" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Sky", value: "#0ea5e9" },
  { label: "Emerald", value: "#10b981" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Rose", value: "#f43f5e" },
  { label: "Slate", value: "#475569" },
  { label: "Charcoal", value: "#1f2937" },
] as const;
