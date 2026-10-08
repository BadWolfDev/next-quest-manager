/**
 * Card attachments — the pure half.
 *
 * Deliberately free of server imports and of the database, so it is
 * unit-testable and the card UI can import the limits to refuse an oversized
 * file before uploading it. Everything security-relevant here is re-applied on
 * the server: the client check is a courtesy, never the gate.
 */

/** The only image types NQM accepts. SVG is absent on purpose: it is a script vector. */
export const ATTACHMENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

export type AttachmentContentType = keyof typeof ATTACHMENT_TYPES;

/** For `<input accept>`. Cosmetic — the server sniffs the bytes regardless. */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES).join(",");

const MB = 1024 * 1024;

/**
 * Per-file ceiling when the bytes go to Vercel Blob. Vercel caps a function's
 * request body at 4.5 MB and the multipart envelope needs some of that.
 */
export const MAX_BLOB_ATTACHMENT_BYTES = 4 * MB;

/**
 * Per-file ceiling for the Postgres fallback. Lower, because every byte lives
 * in the primary database and is read back through it on every view.
 */
export const MAX_POSTGRES_ATTACHMENT_BYTES = 2 * MB;

export const MAX_ATTACHMENTS_PER_CARD = 20;

/**
 * Headroom over the file cap for the multipart envelope (boundaries, part
 * headers, the filename). A request whose Content-Length exceeds cap + this is
 * refused before its body is read.
 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Identify an image by its magic bytes.
 *
 * The client's declared MIME type and the filename extension are both ignored
 * — either can be anything. Only the leading bytes decide, and only the four
 * raster formats below are recognised; anything else (SVG, HTML, a PDF, a
 * polyglot that does not start with an image signature) returns `null`.
 */
export function sniffImageType(
  bytes: Uint8Array,
): AttachmentContentType | null {
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
  return cleaned || "image";
}

/**
 * A `Content-Disposition: inline` value for a stored filename.
 *
 * The plain `filename=` parameter gets an ASCII-only rendering with quotes and
 * backslashes removed, so nothing a user typed can break out of the quoted
 * string or inject a header; `filename*=` carries the real name RFC 5987-encoded
 * for browsers that understand it.
 */
export function contentDispositionInline(filename: string): string {
  const fallback =
    filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 200) || "image";
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** "1.4 MB", "820 KB", "512 B". */
export function formatBytes(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
