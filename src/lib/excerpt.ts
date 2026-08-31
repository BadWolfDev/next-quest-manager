/**
 * Turn markdown into a short plain-text preview for a board card face.
 *
 * Two jobs, both deliberate:
 *  - **Strip the syntax.** A card face showing `## Ship it **now**` reads as
 *    noise. Links collapse to their text, images to their alt, emphasis and
 *    heading markers disappear.
 *  - **Truncate at the data layer.** The board payload carries only this
 *    excerpt, never the full markdown. A board with fifty cards of long
 *    descriptions would otherwise ship all of it to the browser on every load
 *    and every freshness refresh, for text nobody can see.
 *
 * Pure and dependency-free so it can run in either environment.
 */

export const EXCERPT_LENGTH = 120;

export function toPlainExcerpt(
  markdown: string | null | undefined,
  maxLength: number = EXCERPT_LENGTH,
): string | null {
  if (!markdown) return null;

  let text = markdown;

  // Fenced code blocks: drop entirely, they never preview well.
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");

  // Images before links — ![alt](src) would otherwise leave a stray "!".
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Inline links and reference links collapse to their visible text.
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // Inline code ticks.
  text = text.replace(/`+([^`]*)`+/g, "$1");

  // Block markers at the start of a line: headings, quotes, list bullets,
  // ordered list numbers, and horizontal rules.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s{0,3}[-*+]\s+/gm, "");
  text = text.replace(/^\s{0,3}\d+[.)]\s+/gm, "");
  text = text.replace(/^\s{0,3}([-*_])\s*(\1\s*){2,}$/gm, " ");

  // Emphasis / strikethrough markers.
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");

  // Table pipes and leftover escapes.
  text = text.replace(/\|/g, " ");
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1");

  // Collapse all whitespace, including the newlines we just orphaned.
  text = text.replace(/\s+/g, " ").trim();

  if (text.length === 0) return null;
  if (text.length <= maxLength) return text;

  // Prefer a word boundary, but never lose more than a trailing word to it.
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace > maxLength - 20 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.trimEnd()}…`;
}
