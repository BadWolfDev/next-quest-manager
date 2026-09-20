import { describe, expect, it } from "vitest";

import { resolveMentions, type MentionCandidate } from "./mentions";

const ann: MentionCandidate = {
  userId: "u-ann",
  name: "Ann",
  email: "ann@example.com",
};
const bob: MentionCandidate = {
  userId: "u-bob",
  name: "Bob Ng",
  email: "bob@example.com",
};
const members = [ann, bob];

describe("resolveMentions — nothing to resolve", () => {
  it("returns nothing for an empty body", () => {
    expect(resolveMentions("", members)).toEqual([]);
  });

  it("returns nothing for a body with no `@` at all", () => {
    expect(resolveMentions("ship it today", members)).toEqual([]);
  });

  it("returns nothing when there are no candidates", () => {
    expect(resolveMentions("@Ann look at this", [])).toEqual([]);
  });

  it("ignores an `@` that matches nobody in the workspace", () => {
    // The candidate set is the guarantee: a comment cannot notify a stranger.
    expect(resolveMentions("@carol please review", members)).toEqual([]);
  });
});

describe("resolveMentions — by display name", () => {
  it("matches a name at the start of the body", () => {
    expect(resolveMentions("@Ann can you look?", members)).toEqual(["u-ann"]);
  });

  it("matches a name mid-sentence", () => {
    expect(resolveMentions("thanks @Ann for this", members)).toEqual(["u-ann"]);
  });

  it("matches a name at the very end of the body", () => {
    expect(resolveMentions("over to @Ann", members)).toEqual(["u-ann"]);
  });

  it("matches a name containing a space", () => {
    expect(resolveMentions("ping @Bob Ng about it", members)).toEqual(["u-bob"]);
  });

  it("matches when followed by punctuation", () => {
    expect(resolveMentions("hi @Ann, ready?", members)).toEqual(["u-ann"]);
    expect(resolveMentions("(@Ann)", members)).toEqual(["u-ann"]);
  });

  it("matches across a newline boundary", () => {
    expect(resolveMentions("done\n@Ann\nnext", members)).toEqual(["u-ann"]);
  });
});

describe("resolveMentions — by email", () => {
  it("matches a full email address", () => {
    expect(resolveMentions("@ann@example.com ping", members)).toEqual([
      "u-ann",
    ]);
  });

  it("does not match a bare email written without the leading `@`", () => {
    // "bob@example.com" holds an `@`, but the token before it is a word
    // character, so it is an address in prose, not a mention.
    expect(resolveMentions("mail bob@example.com", members)).toEqual([]);
  });

  it("does not read the domain of someone else's address as a mention", () => {
    const domain: MentionCandidate = {
      userId: "u-dom",
      name: "example.com",
      email: "dom@other.test",
    };
    expect(resolveMentions("write to bob@example.com", [domain])).toEqual([]);
  });
});

describe("resolveMentions — case insensitivity", () => {
  it("matches regardless of the case used in the body", () => {
    expect(resolveMentions("@ANN hello", members)).toEqual(["u-ann"]);
    expect(resolveMentions("@ann hello", members)).toEqual(["u-ann"]);
    expect(resolveMentions("@bob ng hello", members)).toEqual(["u-bob"]);
    expect(resolveMentions("@ANN@EXAMPLE.COM hello", members)).toEqual([
      "u-ann",
    ]);
  });

  it("matches regardless of the case stored on the candidate", () => {
    const shouty: MentionCandidate = {
      userId: "u-shout",
      name: "ANN",
      email: "ANN@EXAMPLE.COM",
    };
    expect(resolveMentions("@ann hi", [shouty])).toEqual(["u-shout"]);
  });
});

describe("resolveMentions — no false positives", () => {
  it("does not match a longer name that merely starts with the candidate", () => {
    // "@Annabel" is not a mention of "Ann".
    expect(resolveMentions("@Annabel hello", members)).toEqual([]);
  });

  it("does not match when the `@` sits inside a word", () => {
    expect(resolveMentions("foo@Ann bar", members)).toEqual([]);
  });

  it("does not match a name written without the `@`", () => {
    expect(resolveMentions("Ann said no", members)).toEqual([]);
  });

  it("does not match a name followed by a digit or underscore", () => {
    expect(resolveMentions("@Ann2 hello", members)).toEqual([]);
    expect(resolveMentions("@Ann_b hello", members)).toEqual([]);
  });

  it("ignores a candidate with an empty name but still matches the email", () => {
    const nameless: MentionCandidate = {
      userId: "u-none",
      name: "",
      email: "none@example.com",
    };
    // An empty handle must not match every `@` in the body.
    expect(resolveMentions("hey @Ann", [nameless])).toEqual([]);
    expect(resolveMentions("hey @none@example.com", [nameless])).toEqual([
      "u-none",
    ]);
  });

  it("finds a later occurrence after rejecting an embedded one", () => {
    // The first "@ann" is part of "@annabel"; the scan must keep looking.
    expect(resolveMentions("@annabel and @Ann", members)).toEqual(["u-ann"]);
  });
});

describe("resolveMentions — deduping and order", () => {
  it("returns a user once when mentioned repeatedly", () => {
    expect(resolveMentions("@Ann @Ann @Ann", members)).toEqual(["u-ann"]);
  });

  it("returns a user once when mentioned by both name and email", () => {
    expect(resolveMentions("@Ann and @ann@example.com", members)).toEqual([
      "u-ann",
    ]);
  });

  it("dedupes a candidate list that repeats the same user", () => {
    expect(resolveMentions("@Ann", [ann, { ...ann }])).toEqual(["u-ann"]);
  });

  it("preserves candidate order, not the order of appearance", () => {
    expect(resolveMentions("@Bob Ng then @Ann", members)).toEqual([
      "u-ann",
      "u-bob",
    ]);
  });
});
