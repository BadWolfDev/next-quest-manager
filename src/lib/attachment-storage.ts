import "server-only";

import { del, get, put } from "@vercel/blob";

import type { AttachmentStorage } from "@/db/schema";
import {
  MAX_BLOB_ATTACHMENT_BYTES,
  MAX_POSTGRES_ATTACHMENT_BYTES,
} from "@/lib/attachments";

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
 *  - unset → the bytes go in `card_attachments.data` (`bytea`), with a lower
 *    per-file cap because they then live in the primary database.
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
  return process.env.BLOB_READ_WRITE_TOKEN
    ? { kind: "blob", maxBytes: MAX_BLOB_ATTACHMENT_BYTES }
    : { kind: "postgres", maxBytes: MAX_POSTGRES_ATTACHMENT_BYTES };
}

/** Write bytes to the private store. Returns the pathname to record. */
export async function putBlobObject(
  pathname: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const result = await put(pathname, Buffer.from(bytes), {
    access: "private",
    contentType,
    // The pathname is a fresh uuid; a collision is a bug, not a retry.
    addRandomSuffix: false,
    allowOverwrite: false,
  });
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
