/**
 * Card attachments — the pure half.
 *
 * Deliberately free of server imports and of the database, so it is
 * unit-testable and the card UI can import the limits to refuse an oversized
 * file before uploading it. Everything security-relevant here is re-applied on
 * the server: the client check is a courtesy, never the gate.
 *
 * Any file can be attached. What a file *is* only matters for how it is served,
 * and that is decided by magic bytes alone: the four raster formats below are
 * shown inline, everything else — SVG, HTML, PDF, anything unknown — is an
 * opaque download. The client's declared MIME type and the filename extension
 * are never consulted and never stored.
 */

/** The only types ever served inline. SVG is absent on purpose: it is a script vector. */
export const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

export type ImageContentType = keyof typeof IMAGE_TYPES;

/** What every non-image is stored and served as. */
export const DOWNLOAD_CONTENT_TYPE = "application/octet-stream";

/** Everything `card_attachments.content_type` may hold (mirrored by a CHECK). */
export type StoredContentType = ImageContentType | typeof DOWNLOAD_CONTENT_TYPE;

/**
 * Vercel's function request-body ceiling, read as the stricter of the two
 * possible meanings of its documented "4.5 MB": 4.5 × 10^6 bytes, not 4.5 MiB.
 * The docs give no byte value, and the decimal reading is the one that can
 * never be exceeded under either interpretation. Every upload goes through a
 * function, whatever the storage backend, so this bounds everything.
 */
export const MAX_UPLOAD_REQUEST_BYTES = 4_500_000;

/**
 * Headroom inside that ceiling for the multipart envelope (boundary lines, part
 * headers, the filename). A real envelope is well under 2 kB; the slack covers
 * long UTF-8 filenames with room to spare.
 */
export const MULTIPART_OVERHEAD_BYTES = 100_000;

/**
 * Per-file ceiling, for every backend: whatever is left of the request-body
 * ceiling once the envelope fits. 4.4 MB — shown as such, since a file of
 * exactly 4.5 MB could not be sent.
 */
export const MAX_ATTACHMENT_BYTES =
  MAX_UPLOAD_REQUEST_BYTES - MULTIPART_OVERHEAD_BYTES;

export const MAX_ATTACHMENTS_PER_CARD = 20;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Identify a raster image by its magic bytes.
 *
 * The client's declared MIME type and the filename extension are both ignored
 * — either can be anything. Only the leading bytes decide, and only the four
 * raster formats below are recognised; anything else (SVG, HTML, a PDF, a
 * polyglot that does not start with an image signature) returns `null`.
 */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    startsWith(bytes, ascii("GIF87a")) ||
    startsWith(bytes, ascii("GIF89a"))
  ) {
    return "image/gif";
  }
  // RIFF <4-byte little-endian size> WEBP
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  return null;
}

/** The content type to record for a file whose leading bytes are `bytes`. */
export function storedContentType(bytes: Uint8Array): StoredContentType {
  return sniffImageType(bytes) ?? DOWNLOAD_CONTENT_TYPE;
}

/** True only for the four sniffed raster types — the inline allowlist. */
export function isInlineImage(contentType: string): contentType is ImageContentType {
  return Object.hasOwn(IMAGE_TYPES, contentType);
}

/**
 * How a stored attachment is served. The one place that decides.
 *
 * Only a sniffed raster image goes out `inline` with its real type. Anything
 * else — including a value this module does not recognise, should one ever be
 * in the column — is `attachment` + `application/octet-stream`, so the browser
 * downloads it instead of rendering it on our origin.
 */
export function servedAs(
  storedType: string,
  filename: string,
): { contentType: string; contentDisposition: string; inline: boolean } {
  const inline = isInlineImage(storedType);
  return {
    contentType: inline ? storedType : DOWNLOAD_CONTENT_TYPE,
    contentDisposition: contentDisposition(
      inline ? "inline" : "attachment",
      filename,
    ),
    inline,
  };
}

/**
 * A display filename that is safe to store and show.
 *
 * Strips any directory part (both separators), control characters and
 * bidi-override characters (which can make `gpj.exe` read as `exe.jpg`), and
 * caps the length. Never used as a storage key — blob pathnames are uuids.
 */
export function sanitizeFilename(raw: string | null | undefined): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 200);
  return cleaned || "file";
}

/**
 * A `Content-Disposition` value for a stored filename.
 *
 * The plain `filename=` parameter gets an ASCII-only rendering with quotes and
 * backslashes removed, so nothing a user typed can break out of the quoted
 * string or inject a header; `filename*=` carries the real name RFC 5987-encoded
 * for browsers that understand it.
 */
export function contentDisposition(
  type: "inline" | "attachment",
  filename: string,
): string {
  const fallback =
    filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 200) || "file";
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * Strong validator for an attachment response.
 *
 * An attachment's bytes never change for its id — there is no replace, only
 * delete and re-upload under a new id — so the id itself is a correct ETag.
 */
export function attachmentETag(attachmentId: string): string {
  return `"${attachmentId}"`;
}

/**
 * Whether an `If-None-Match` header matches `etag` (RFC 9110 §13.1.2: weak
 * comparison, so a `W/` prefix is ignored; `*` matches any current entity).
 */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false;
  const want = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((tag) => tag.trim())
    .some((tag) => tag === "*" || tag.replace(/^W\//, "") === want);
}

/**
 * "4.4 MB", "820 kB", "512 B" — decimal (SI) units, the same ones the size
 * limit is stated in, so the cap reads as exactly what it is.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} kB`;
  return `${bytes} B`;
}
