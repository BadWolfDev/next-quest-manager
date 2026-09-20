import { describe, expect, it } from "vitest";

import { EXCERPT_LENGTH, toPlainExcerpt } from "./excerpt";

describe("toPlainExcerpt — empty input", () => {
  it("returns null for null, undefined and empty string", () => {
    expect(toPlainExcerpt(null)).toBeNull();
    expect(toPlainExcerpt(undefined)).toBeNull();
    expect(toPlainExcerpt("")).toBeNull();
  });

  it("returns null when nothing survives stripping", () => {
    expect(toPlainExcerpt("   \n\n  ")).toBeNull();
    expect(toPlainExcerpt("```\nconst x = 1;\n```")).toBeNull();
    expect(toPlainExcerpt("---")).toBeNull();
  });
});

describe("toPlainExcerpt — markdown stripping", () => {
  it("drops heading markers", () => {
    expect(toPlainExcerpt("## Ship it")).toBe("Ship it");
  });

  it("drops emphasis and strikethrough markers", () => {
    expect(toPlainExcerpt("**bold** and _italic_ and ~~gone~~")).toBe(
      "bold and italic and gone",
    );
  });

  it("collapses links to their text", () => {
    expect(toPlainExcerpt("See [the docs](https://example.com/a).")).toBe(
      "See the docs.",
    );
  });

  it("collapses reference links to their text", () => {
    expect(toPlainExcerpt("See [the docs][1].")).toBe("See the docs.");
  });

  it("collapses images to their alt text without a stray bang", () => {
    expect(toPlainExcerpt("![a diagram](/x.png) follows")).toBe(
      "a diagram follows",
    );
  });

  it("drops fenced code blocks entirely", () => {
    expect(toPlainExcerpt("Before\n\n```js\nconst x = 1;\n```\n\nAfter")).toBe(
      "Before After",
    );
  });

  it("drops tilde-fenced code blocks too", () => {
    expect(toPlainExcerpt("Before\n~~~\ncode\n~~~\nAfter")).toBe(
      "Before After",
    );
  });

  it("unwraps inline code", () => {
    expect(toPlainExcerpt("Run `npm test` now")).toBe("Run npm test now");
  });

  it("drops list bullets and ordered numbers", () => {
    expect(toPlainExcerpt("- one\n- two\n1. three")).toBe("one two three");
  });

  it("drops blockquote markers", () => {
    expect(toPlainExcerpt("> quoted")).toBe("quoted");
  });

  it("turns table pipes into spaces", () => {
    expect(toPlainExcerpt("| a | b |")).toBe("a b");
  });

  it("unescapes backslash escapes", () => {
    expect(toPlainExcerpt("literal \\[brackets\\]")).toBe("literal [brackets]");
    expect(toPlainExcerpt("\\# not a heading")).toBe("# not a heading");
  });

  it("keeps escaped emphasis markers as literal characters", () => {
    // The escape has to survive the emphasis pass: strip it first and
    // `\*stars\*` is read as emphasis around "stars\".
    expect(toPlainExcerpt("\\*stars\\*")).toBe("*stars*");
    expect(toPlainExcerpt("\\_under\\_ and \\~\\~tilde\\~\\~")).toBe(
      "_under_ and ~~tilde~~",
    );
  });

  it("does not treat an escaped block marker as a block marker", () => {
    expect(toPlainExcerpt("\\- not a bullet")).toBe("- not a bullet");
    expect(toPlainExcerpt("\\> not a quote")).toBe("> not a quote");
  });

  it("still strips real emphasis around escaped characters", () => {
    expect(toPlainExcerpt("**bold \\* star**")).toBe("bold * star");
  });

  it("unescapes a literal backslash", () => {
    expect(toPlainExcerpt("a \\\\ b")).toBe("a \\ b");
  });

  it("collapses all whitespace onto one line", () => {
    expect(toPlainExcerpt("one\n\n  two\t three")).toBe("one two three");
  });
});

describe("toPlainExcerpt — truncation", () => {
  it("leaves text at or under the limit alone", () => {
    const text = "x".repeat(EXCERPT_LENGTH);
    expect(toPlainExcerpt(text)).toBe(text);
  });

  it("truncates with an ellipsis past the limit", () => {
    const excerpt = toPlainExcerpt("word ".repeat(100));
    expect(excerpt).not.toBeNull();
    expect(excerpt!.endsWith("…")).toBe(true);
    expect(excerpt!.length).toBeLessThanOrEqual(EXCERPT_LENGTH + 1);
  });

  it("prefers a word boundary when one is close to the limit", () => {
    const excerpt = toPlainExcerpt("alpha ".repeat(40));
    expect(excerpt!.endsWith("alpha…")).toBe(true);
  });

  it("cuts mid-word rather than losing a long trailing word", () => {
    const excerpt = toPlainExcerpt("hi " + "z".repeat(300));
    expect(excerpt).toBe("hi " + "z".repeat(EXCERPT_LENGTH - 3) + "…");
  });

  it("honours an explicit maxLength", () => {
    expect(toPlainExcerpt("alpha beta gamma", 12)).toBe("alpha beta…");
    expect(toPlainExcerpt("alpha beta gamma", 100)).toBe("alpha beta gamma");
  });

  it("cuts at the limit when a small clip holds no space", () => {
    // `lastIndexOf` returns -1 here. Treating that as a cut index dropped the
    // last character for no reason.
    expect(toPlainExcerpt("abcdefghij", 4)).toBe("abcd…");
    expect(toPlainExcerpt("abcdefghij", 1)).toBe("a…");
  });

  it("still prefers a word boundary at a tiny limit", () => {
    expect(toPlainExcerpt("a bcdefghij", 3)).toBe("a…");
  });

  it("keeps the whole word-boundary rule for a normal limit", () => {
    expect(toPlainExcerpt("alpha beta gamma", 13)).toBe("alpha beta…");
  });

  it("measures the stripped text, not the markdown source", () => {
    // The syntax is far longer than the limit; the visible text is not.
    const markdown = `[${"a".repeat(20)}](${"https://example.com/".repeat(20)})`;
    expect(toPlainExcerpt(markdown)).toBe("a".repeat(20));
  });
});
