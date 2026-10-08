import { describe, expect, it } from "vitest";

import {
  contentDispositionInline,
  formatBytes,
  sanitizeFilename,
  sniffImageType,
} from "@/lib/attachments";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(
    values.flatMap((v) =>
      typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v],
    ),
  );

describe("sniffImageType", () => {
  it("recognises PNG", () => {
    expect(
      sniffImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)),
    ).toBe("image/png");
  });

  it("recognises JPEG", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, "JFIF"))).toBe(
      "image/jpeg",
    );
  });

  it("recognises both GIF versions", () => {
    expect(sniffImageType(bytes("GIF87a", 1, 0))).toBe("image/gif");
    expect(sniffImageType(bytes("GIF89a", 1, 0))).toBe("image/gif");
  });

  it("recognises WebP only with the WEBP form type", () => {
    expect(sniffImageType(bytes("RIFF", 0x24, 0, 0, 0, "WEBPVP8 "))).toBe(
      "image/webp",
    );
    // A RIFF container that is not WebP (e.g. WAV) is refused.
    expect(sniffImageType(bytes("RIFF", 0x24, 0, 0, 0, "WAVEfmt "))).toBeNull();
  });

  it("rejects SVG, even with an XML prolog or leading whitespace", () => {
    expect(
      sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeNull();
    expect(sniffImageType(bytes('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageType(bytes("  \n<svg onload=alert(1)>"))).toBeNull();
  });

  it("rejects HTML and other non-images", () => {
    expect(sniffImageType(bytes("<!doctype html><script>"))).toBeNull();
    expect(sniffImageType(bytes("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
  });

  it("rejects truncated signatures and empty input", () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(bytes(0x89, "PN"))).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImageType(bytes("GIF8"))).toBeNull();
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WEB"))).toBeNull();
  });

  it("does not match a signature that appears after the start", () => {
    expect(
      sniffImageType(bytes("<html>", 0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("drops directory parts from either separator", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\shot.png")).toBe("shot.png");
  });

  it("strips control and bidi-override characters", () => {
    expect(sanitizeFilename("a\u0000b\nc.png")).toBe("abc.png");
    expect(sanitizeFilename("photo\u202egpj.exe")).toBe("photogpj.exe");
  });

  it("falls back when nothing is left", () => {
    expect(sanitizeFilename("")).toBe("image");
    expect(sanitizeFilename(null)).toBe("image");
    expect(sanitizeFilename("/")).toBe("image");
  });

  it("caps the length", () => {
    expect(sanitizeFilename("x".repeat(500) + ".png")).toHaveLength(200);
  });
});

describe("contentDispositionInline", () => {
  it("keeps a plain name readable", () => {
    expect(contentDispositionInline("shot.png")).toBe(
      "inline; filename=\"shot.png\"; filename*=UTF-8''shot.png",
    );
  });

  it("cannot be broken out of with quotes, semicolons or newlines", () => {
    const value = contentDispositionInline('a";\r\nX-Evil: 1;.png');
    expect(value).not.toMatch(/[\r\n]/);
    const fallback = value.match(/filename="([^"]*)"/)?.[1];
    expect(fallback).toBe("a____X-Evil_ 1_.png");
  });

  it("percent-encodes non-ASCII names in filename*", () => {
    expect(contentDispositionInline("café ☕.png")).toContain(
      "filename*=UTF-8''caf%C3%A9%20%E2%98%95.png",
    );
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
