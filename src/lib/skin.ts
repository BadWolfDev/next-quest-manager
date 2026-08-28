/**
 * Visual skins.
 *
 * `default` is the existing light/dark theme driven by next-themes (which uses
 * `attribute="class"`, so it stamps `.light`/`.dark` on <html>). The other three
 * are self-contained dark skins from the design handoff, applied as
 * `data-theme` on <html>.
 *
 * There is no collision between the two systems: next-themes owns the class,
 * skins own the attribute. `:root[data-theme="pixel"]` has higher specificity
 * (0,2,0) than `.dark` (0,1,0), so an active skin overrides the light/dark
 * palette without having to disable the toggle. The toggle is hidden while a
 * skin is active because it would have no visible effect.
 *
 * Stored in localStorage, per device — deliberately not per user in the
 * database, so a shared account can look different on different machines and
 * there is no round trip on first paint.
 */

export const SKINS = ["default", "pixel", "grid", "retro"] as const;
export type Skin = (typeof SKINS)[number];

export const SKIN_STORAGE_KEY = "nqm-skin";
export const SCANLINES_STORAGE_KEY = "nqm-scanlines";

export const SKIN_META: Record<
  Skin,
  { label: string; blurb: string; swatch: [string, string, string] }
> = {
  default: {
    label: "Default",
    blurb: "Follows your light / dark setting",
    swatch: ["#fbfbfd", "#6d4aff", "#17171c"],
  },
  pixel: {
    label: "Pixel Quest",
    blurb: "8-bit console UI",
    swatch: ["#1a1c2c", "#ef7d57", "#38b764"],
  },
  grid: {
    label: "Grid Protocol",
    blurb: "Tron hairlines and glow",
    swatch: ["#04070c", "#7df9ff", "#ff8a2b"],
  },
  retro: {
    label: "Miami Deadline",
    blurb: "80s neon on violet",
    swatch: ["#221046", "#ff2e93", "#00e5ff"],
  },
};

export function isSkin(value: unknown): value is Skin {
  return typeof value === "string" && (SKINS as readonly string[]).includes(value);
}

/** Skins that are self-contained dark themes (i.e. everything except default). */
export function isCustomSkin(skin: Skin): boolean {
  return skin !== "default";
}

/**
 * The inline <head> script, stringified.
 *
 * Runs before first paint so the skin attribute is on <html> before any pixels
 * land — the same trick next-themes uses for light/dark. Every storage read is
 * wrapped: a browser with site data blocked throws on access, and that must not
 * take the page down.
 */
export const SKIN_INIT_SCRIPT = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(SKIN_STORAGE_KEY)});
var v=${JSON.stringify(SKINS)};
if(s&&v.indexOf(s)>-1&&s!=="default"){document.documentElement.setAttribute("data-theme",s);}
var l=localStorage.getItem(${JSON.stringify(SCANLINES_STORAGE_KEY)});
if(l!=="off"){document.documentElement.setAttribute("data-scanlines","on");}
}catch(e){}})();`;
