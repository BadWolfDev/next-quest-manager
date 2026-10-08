import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_CONTENT_TYPE,
  MAX_ATTACHMENT_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  MULTIPART_OVERHEAD_BYTES,
  attachmentETag,
  contentDisposition,
  formatBytes,
  ifNoneMatchHits,
  isInlineImage,
  sanitizeFilename,
  servedAs,
  sniffImageType,
  storedContentType,
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
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename(null)).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
  });

  it("caps the length", () => {
    expect(sanitizeFilename("x".repeat(500) + ".png")).toHaveLength(200);
  });
});

describe("contentDisposition", () => {
  it("keeps a plain name readable", () => {
    expect(contentDisposition("inline", "shot.png")).toBe(
      "inline; filename=\"shot.png\"; filename*=UTF-8''shot.png",
    );
    expect(contentDisposition("attachment", "report.pdf")).toBe(
      "attachment; filename=\"report.pdf\"; filename*=UTF-8''report.pdf",
    );
  });

  it("cannot be broken out of with quotes, semicolons or newlines", () => {
    const value = contentDisposition("attachment", 'a";\r\nX-Evil: 1;.png');
    expect(value).not.toMatch(/[\r\n]/);
    const fallback = value.match(/filename="([^"]*)"/)?.[1];
    expect(fallback).toBe("a____X-Evil_ 1_.png");
  });

  it("percent-encodes non-ASCII names in filename*", () => {
    expect(contentDisposition("inline", "café ☕.png")).toContain(
      "filename*=UTF-8''caf%C3%A9%20%E2%98%95.png",
    );
  });
});

const PNG = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);

describe("storedContentType", () => {
  it("records sniffed images by their real type", () => {
    expect(storedContentType(PNG)).toBe("image/png");
    expect(storedContentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("records everything else as an opaque download", () => {
    for (const body of [
      "<svg onload=alert(1)>",
      "<!doctype html><script>alert(1)</script>",
      "%PDF-1.7",
      "",
    ]) {
      expect(storedContentType(bytes(body))).toBe(DOWNLOAD_CONTENT_TYPE);
    }
  });
});

describe("servedAs — the inline allowlist", () => {
  it("serves the four sniffed raster types inline with their type", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      const served = servedAs(type, "x.bin");
      expect(served.inline).toBe(true);
      expect(served.contentType).toBe(type);
      expect(served.contentDisposition.startsWith("inline;")).toBe(true);
    }
  });

  it("serves everything else as an octet-stream attachment", () => {
    for (const type of [
      DOWNLOAD_CONTENT_TYPE,
      "image/svg+xml",
      "text/html",
      "application/pdf",
      "application/xhtml+xml",
      "IMAGE/PNG",
      "image/png; charset=utf-8",
      "",
      "toString",
      "__proto__",
    ]) {
      const served = servedAs(type, "page.html");
      expect(served.inline).toBe(false);
      expect(served.contentType).toBe("application/octet-stream");
      expect(
        served.contentDisposition.startsWith('attachment; filename="page.html"'),
      ).toBe(true);
    }
  });

  it("does not let the filename influence the decision", () => {
    expect(servedAs(DOWNLOAD_CONTENT_TYPE, "photo.png").inline).toBe(false);
    expect(servedAs("image/png", "evil.html").inline).toBe(true);
    expect(isInlineImage("hasOwnProperty")).toBe(false);
  });
});

describe("ETag and If-None-Match", () => {
  const id = "0b7c5a3e-2f1d-4c8b-9a6e-1d2c3b4a5f60";
  const etag = attachmentETag(id);

  it("uses the quoted id as a strong ETag", () => {
    expect(etag).toBe(`"${id}"`);
  });

  it("matches exact, weak, listed and wildcard validators", () => {
    expect(ifNoneMatchHits(etag, etag)).toBe(true);
    expect(ifNoneMatchHits(`W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchHits(`"other", ${etag}`, etag)).toBe(true);
    expect(ifNoneMatchHits("*", etag)).toBe(true);
  });

  it("misses absent or different validators", () => {
    expect(ifNoneMatchHits(null, etag)).toBe(false);
    expect(ifNoneMatchHits("", etag)).toBe(false);
    expect(ifNoneMatchHits('"other"', etag)).toBe(false);
    expect(ifNoneMatchHits(id, etag)).toBe(false);
  });
});

describe("size limits", () => {
  it("fits a max-size file plus the multipart envelope under 4.5 MB (decimal)", () => {
    expect(MAX_UPLOAD_REQUEST_BYTES).toBe(4_500_000);
    expect(MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES).toBeLessThanOrEqual(
      MAX_UPLOAD_REQUEST_BYTES,
    );
    // ...and therefore under the 4.5 MiB reading as well.
    expect(MAX_UPLOAD_REQUEST_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("states the cap truthfully", () => {
    expect(formatBytes(MAX_ATTACHMENT_BYTES)).toBe("4.4 MB");
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 kB");
    expect(formatBytes(1_500_000)).toBe("1.5 MB");
  });
});
