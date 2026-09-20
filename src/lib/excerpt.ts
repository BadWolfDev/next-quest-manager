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

/**
 * Private-use sentinel wrapping the index of a parked backslash escape. Chosen
 * from a Unicode private-use area so it cannot appear in real card text, and it
 * is neither whitespace nor markdown punctuation, so no stripping pass reacts
 * to it.
 */
const ESCAPE_MARK = "";

export function toPlainExcerpt(
  markdown: string | null | undefined,
  maxLength: number = EXCERPT_LENGTH,
): string | null {
  if (!markdown) return null;

  let text = markdown;

  // Fenced code blocks: drop entirely, they never preview well.
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");

  // Backslash-escaped punctuation is *content*, not syntax, so it has to be
  // taken out of play before any of the syntax passes run — otherwise
  // `\*stars\*` reaches the emphasis pass as a pair of asterisks and comes back
  // as `\stars\`. Each escape is parked behind a placeholder and restored once
  // the stripping is done.
  const escapes: string[] = [];
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (_match, ch: string) => {
    escapes.push(ch);
    return `${ESCAPE_MARK}${escapes.length - 1}${ESCAPE_MARK}`;
  });

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

  // Table pipes.
  text = text.replace(/\|/g, " ");

  // Now that no pass can mistake them for syntax, put the escaped characters
  // back as themselves — `\*stars\*` becomes `*stars*`.
  text = text.replace(
    new RegExp(`${ESCAPE_MARK}(\\d+)${ESCAPE_MARK}`, "g"),
    (_match, index: string) => escapes[Number(index)] ?? "",
  );

  // Collapse all whitespace, including the newlines we just orphaned.
  text = text.replace(/\s+/g, " ").trim();

  if (text.length === 0) return null;
  if (text.length <= maxLength) return text;

  // Prefer a word boundary, but never lose more than a trailing word to it.
  // `lastIndexOf` returns -1 when the clip holds no space at all, and 0 when it
  // starts with one; neither is a cut, so the floor is a real index. Without it
  // a small `maxLength` would read -1 as "cut one character short".
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  const minCut = Math.max(1, maxLength - 20);
  const base = lastSpace >= minCut ? clipped.slice(0, lastSpace) : clipped;
  return `${base.trimEnd()}…`;
}
