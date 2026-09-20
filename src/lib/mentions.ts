/**
 * `@mention` resolution for comment bodies.
 *
 * Deliberately *not* a regex that invents a mention grammar. A display name can
 * contain spaces, punctuation and non-ASCII characters, and an email contains
 * an `@` of its own — any pattern general enough to capture both would also
 * capture half the prose around it. Instead we take the candidate set we
 * already trust (the workspace's members) and ask, for each one, whether the
 * body mentions them. Nothing outside the workspace can ever be matched, which
 * is the property that matters: a comment cannot be used to notify a stranger.
 *
 * Pure and dependency-free so it can be unit-tested without a database.
 */

export type MentionCandidate = {
  userId: string;
  name: string;
  email: string;
};

/**
 * Characters that may *not* immediately follow a mention. Without this,
 * "@Ann" would match a member called "An". Word characters continue a token;
 * anything else (space, punctuation, end of string) terminates it.
 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

function mentions(body: string, handle: string): boolean {
  if (handle.length === 0) return false;

  const haystack = body.toLowerCase();
  const needle = `@${handle.toLowerCase()}`;

  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;

    // The `@` must start a token: preceded by whitespace, punctuation or the
    // start of the string. Otherwise "user@example.com" would be read as a
    // mention of "example.com".
    const before = at > 0 ? haystack[at - 1] : undefined;
    const after = haystack[at + needle.length];

    if (!isWordChar(before) && !isWordChar(after)) {
      return true;
    }
    from = at + 1;
  }
}

/**
 * User ids mentioned in `body`, resolved against `candidates`.
 *
 * Matches `@<display name>` or `@<email>`, case-insensitively. The result is
 * deduped and preserves candidate order.
 */
export function resolveMentions(
  body: string,
  candidates: MentionCandidate[],
): string[] {
  if (!body.includes("@")) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate.userId)) continue;
    if (mentions(body, candidate.email) || mentions(body, candidate.name)) {
      seen.add(candidate.userId);
      out.push(candidate.userId);
    }
  }

  return out;
}
