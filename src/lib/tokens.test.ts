import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// Every token module reaches for the Drizzle client at import time, and
// `db/index.ts` opens a pool as a module side effect. These tests only exercise
// the pure format/hash helpers, so the client is stubbed out entirely.
vi.mock("@/db", () => ({ db: {}, sql: {}, schema: {} }));

const { TOKEN_PREFIX, generateToken, hashToken } = await import(
  "./api-tokens"
);
const { INVITE_PREFIX, generateInviteToken, hashInviteToken } = await import(
  "./invites"
);
const {
  USER_INVITE_PREFIX,
  DISPLAY_PREFIX_LENGTH,
  generateUserInviteToken,
  hashUserInviteToken,
} = await import("./registration");

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** The three token families, which share a shape but must never share a space. */
const families = [
  {
    name: "personal access token",
    prefix: TOKEN_PREFIX,
    expectedPrefix: "nqm_",
    generate: generateToken,
    hash: hashToken,
  },
  {
    name: "workspace invite",
    prefix: INVITE_PREFIX,
    expectedPrefix: "nqi_",
    generate: generateInviteToken,
    hash: hashInviteToken,
  },
  {
    name: "instance invite",
    prefix: USER_INVITE_PREFIX,
    expectedPrefix: "nqu_",
    generate: generateUserInviteToken,
    hash: hashUserInviteToken,
  },
] as const;

describe.each(families)("$name tokens", ({ prefix, expectedPrefix, generate, hash }) => {
  it("uses the documented prefix", () => {
    expect(prefix).toBe(expectedPrefix);
    expect(generate().raw.startsWith(expectedPrefix)).toBe(true);
  });

  it("carries 32 bytes of entropy as base64url", () => {
    const { raw } = generate();
    const body = raw.slice(expectedPrefix.length);
    // 32 bytes → 43 unpadded base64url characters.
    expect(body).toHaveLength(43);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a display prefix that is a prefix of the raw token", () => {
    const { raw, prefix: display } = generate();
    expect(display).toHaveLength(DISPLAY_PREFIX_LENGTH);
    expect(raw.startsWith(display)).toBe(true);
    expect(display.startsWith(expectedPrefix)).toBe(true);
  });

  it("stores a SHA-256 digest of the raw token, not the token", () => {
    const { raw, hash: stored } = generate();
    expect(stored).toBe(sha256(raw));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(raw);
  });

  it("hashes deterministically — the lookup is one indexed equality", () => {
    const { raw } = generate();
    expect(hash(raw)).toBe(hash(raw));
  });

  it("hashes distinctly for a one-character difference", () => {
    const { raw } = generate();
    const tampered = raw.slice(0, -1) + (raw.endsWith("A") ? "B" : "A");
    expect(hash(tampered)).not.toBe(hash(raw));
  });

  it("never repeats a token", () => {
    const raws = new Set(Array.from({ length: 200 }, () => generate().raw));
    expect(raws.size).toBe(200);
  });
});

describe("token families are disjoint", () => {
  it("uses three distinct prefixes", () => {
    expect(new Set([TOKEN_PREFIX, INVITE_PREFIX, USER_INVITE_PREFIX]).size).toBe(
      3,
    );
  });

  it("keeps instance invites separate from workspace invites", () => {
    // Merging these would make a workspace invite a signup back door.
    expect(generateInviteToken().raw.startsWith(USER_INVITE_PREFIX)).toBe(false);
    expect(generateUserInviteToken().raw.startsWith(INVITE_PREFIX)).toBe(false);
  });

  it("uses one hash function, so a digest alone identifies nothing", () => {
    const raw = "nqi_abc";
    expect(hashInviteToken(raw)).toBe(hashToken(raw));
    expect(hashUserInviteToken(raw)).toBe(hashToken(raw));
  });
});
