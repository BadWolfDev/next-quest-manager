import "server-only";

import { del, get, put } from "@vercel/blob";

import type { AttachmentStorage } from "@/db/schema";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";

/**
 * Where attachment bytes go — the one place that decides.
 *
 * NQM's deployment promise is "DATABASE_URL and AUTH_SECRET, nothing else", so
 * object storage is *optional*:
 *
 *  - `BLOB_READ_WRITE_TOKEN` set → a **private** Vercel Blob store. The bytes
 *    never touch Postgres, and the store's URLs are never handed to a browser:
 *    every read is proxied through `/api/attachments/[id]` after an
 *    authorization check.
 *  - unset → the bytes go in `card_attachments.data` (`bytea`).
 *
 * Either way the upload arrives through our own route handler, so one per-file
 * cap applies to both: `MAX_ATTACHMENT_BYTES`, sized to fit Vercel's function
 * request-body limit with the multipart envelope (see `lib/attachments.ts`).
 *
 * The choice is made per *upload* and recorded on the row (`storage`). Reads
 * and deletes dispatch on the row, never on the current environment, so
 * flipping the variable later strands nothing: old Postgres rows keep reading
 * from Postgres, old blob rows keep reading from the bucket (as long as the
 * token is still there to read it with).
 */

export function uploadBackend(): {
  kind: AttachmentStorage;
  maxBytes: number;
} {
  return {
    kind: process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "postgres",
    maxBytes: MAX_ATTACHMENT_BYTES,
  };
}

/**
 * Write bytes to the private store. Returns the pathname to record.
 *
 * Stored as `application/octet-stream` whatever the file is: what it is served
 * as is decided by our route from the sniffed type on the row, and the store
 * never needs to know.
 */
export async function putBlobObject(
  pathname: string,
  bytes: Uint8Array,
): Promise<string> {
  const result = await put(
    pathname,
    // A view over the same memory, not a copy.
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    {
      access: "private",
      contentType: "application/octet-stream",
      // The pathname is a fresh uuid; a collision is a bug, not a retry.
      addRandomSuffix: false,
      allowOverwrite: false,
    },
  );
  return result.pathname;
}

/** Stream a private object, or null when the store no longer has it. */
export async function getBlobObject(
  pathname: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return result.stream;
}

/** Remove private objects. Throws on failure — callers decide whether that matters. */
export async function deleteBlobObjects(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  await del(pathnames);
}
