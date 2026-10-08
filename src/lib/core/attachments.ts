import "server-only";

import { randomUUID } from "node:crypto";

import { and, count, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { boards, cardAttachments, cards } from "@/db/schema";
import { recordActivity } from "@/lib/activity";
import {
  deleteBlobObjects,
  getBlobObject,
  putBlobObject,
  uploadBackend,
} from "@/lib/attachment-storage";
import {
  MAX_ATTACHMENTS_PER_CARD,
  attachmentETag,
  formatBytes,
  ifNoneMatchHits,
  sanitizeFilename,
  storedContentType,
} from "@/lib/attachments";
import { requireCardAccess, READ_MIN_ROLE, type Actor } from "@/lib/authorize";
import { sourceData, touchBoard, type OpContext } from "@/lib/core/board-ops";
import { AuthorizationError, UploadRejectedError } from "@/lib/errors";
import { logError } from "@/lib/log-error";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Card attachments: upload, serve, delete.
 *
 * Same contract as `board-ops`: one implementation, an optional `actor`
 * (undefined = the browser session), authorization through
 * `requireCardAccess` before any data is touched. The card's attachment list is
 * read by `getCardModalData` alongside the rest of the card.
 *
 * Any file may be attached. Its stored `content_type` is decided here, from its
 * leading bytes only: a sniffed raster image type, or `application/octet-stream`.
 * How that is served is decided by `servedAs` in `lib/attachments.ts`.
 *
 * There is deliberately no MCP upload tool. `get_card` reports attachment
 * metadata; bytes only ever leave through `/api/attachments/[id]`.
 */

/** Uploads per user per window. Generous for pasting a burst of screenshots. */
const UPLOAD_RATE_LIMIT = { limit: 30, windowSeconds: 10 * 60 } as const;

export type UploadedFile = { filename: string; bytes: Uint8Array };

/** The one wording of the size refusal, shared with the upload route. */
export function tooLargeMessage(maxBytes: number): string {
  return `Files can be at most ${formatBytes(maxBytes)}.`;
}

/**
 * Attach a file to a card.
 *
 * `readFile` is called only *after* the caller is authorised, rate-limited and
 * the card is known to have room — so an outsider, a viewer or a flood never
 * gets as far as making the server buffer a request body. It receives the
 * per-file cap so the transport can refuse an oversized body by its
 * Content-Length before reading it.
 */
export async function uploadAttachment(
  input: {
    cardId: string;
    readFile: (maxBytes: number) => Promise<UploadedFile>;
  },
  { actor, source }: OpContext = {},
) {
  const ctx = await requireCardAccess(input.cardId, "member", actor);

  const limited = await rateLimit({
    key: `attachment-upload:${ctx.user.id}`,
    ...UPLOAD_RATE_LIMIT,
  });
  if (!limited.ok) {
    throw new UploadRejectedError(
      "You're uploading too quickly. Try again in a few minutes.",
      429,
    );
  }

  await assertRoom(input.cardId);

  const backend = uploadBackend();
  const file = await input.readFile(backend.maxBytes);
  const size = file.bytes.byteLength;

  if (size === 0) {
    throw new UploadRejectedError("That file is empty.");
  }
  if (size > backend.maxBytes) {
    throw new UploadRejectedError(tooLargeMessage(backend.maxBytes), 413);
  }

  const contentType = storedContentType(file.bytes);
  const id = randomUUID();
  const filename = sanitizeFilename(file.filename);

  // The object is written before the row so a row never points at nothing.
  // The pathname is the attachment's own uuid — never anything user-supplied,
  // and no extension: what the file is lives on the row, not in its name.
  const blobPathname =
    backend.kind === "blob"
      ? await putBlobObject(`attachments/${id}`, file.bytes)
      : null;

  try {
    const createdAt = await db.transaction(async (tx) => {
      // Lock the card so two concurrent uploads cannot both squeeze under the
      // per-card cap, and re-read its board: a card moved to another board
      // since `requireCardAccess` ran must not be attached under the old one.
      const [card] = await tx
        .select({ boardId: cards.boardId })
        .from(cards)
        .where(eq(cards.id, input.cardId))
        .for("update")
        .limit(1);
      if (!card || card.boardId !== ctx.board.id) {
        throw new AuthorizationError();
      }

      const [{ n }] = await tx
        .select({ n: count() })
        .from(cardAttachments)
        .where(eq(cardAttachments.cardId, input.cardId));
      if (n >= MAX_ATTACHMENTS_PER_CARD) throw tooMany();

      const [row] = await tx
        .insert(cardAttachments)
        .values({
          id,
          cardId: input.cardId,
          boardId: ctx.board.id,
          uploaderId: ctx.user.id,
          filename,
          contentType,
          byteSize: size,
          storage: backend.kind,
          blobPathname,
          // A view over the request's bytes, not a copy.
          data: blobPathname
            ? null
            : Buffer.from(
                file.bytes.buffer,
                file.bytes.byteOffset,
                file.bytes.byteLength,
              ),
        })
        .returning({ createdAt: cardAttachments.createdAt });

      await touchBoard(tx, ctx.board.id);

      await recordActivity(tx, {
        workspaceId: ctx.workspace.id,
        boardId: ctx.board.id,
        cardId: input.cardId,
        actorId: ctx.user.id,
        type: "attachment.added",
        data: { attachmentId: id, filename, ...sourceData(source) },
      });

      return row.createdAt;
    });

    return {
      boardId: ctx.board.id,
      attachment: { id, filename, contentType, byteSize: size, createdAt },
    };
  } catch (error) {
    if (blobPathname)
      await discardBlobObjects([blobPathname], "upload-rollback");
    throw error;
  }
}

function tooMany() {
  return new UploadRejectedError(
    `A card can hold at most ${MAX_ATTACHMENTS_PER_CARD} attachments.`,
  );
}

/** Cheap pre-check so a full card is refused before its body is read. */
async function assertRoom(cardId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(cardAttachments)
    .where(eq(cardAttachments.cardId, cardId));
  if (n >= MAX_ATTACHMENTS_PER_CARD) throw tooMany();
}

/**
 * Remove an attachment — row and bytes.
 *
 * A deliberate exception to soft deletes: an orphaned file has no history
 * value, and keeping its bytes after the user asked for them gone is the
 * opposite of what they meant. The activity entry records that it existed.
 *
 * Permission mirrors comment moderation: the uploader, or a workspace
 * admin/owner — and always at the write floor, so a viewer can delete nothing.
 *
 * The row is deleted first, inside the transaction; the blob object after
 * commit. If that second step fails the user's intent has still been honoured
 * (nothing can reach the object without its row), so it is logged, not thrown.
 */
export async function deleteAttachment(
  input: { attachmentId: string },
  { actor, source }: OpContext = {},
): Promise<{ boardId: string; cardId: string }> {
  const [row] = await db
    .select({
      cardId: cardAttachments.cardId,
      uploaderId: cardAttachments.uploaderId,
      filename: cardAttachments.filename,
      storage: cardAttachments.storage,
      blobPathname: cardAttachments.blobPathname,
    })
    .from(cardAttachments)
    .where(eq(cardAttachments.id, input.attachmentId))
    .limit(1);

  if (!row) throw new AuthorizationError();

  const ctx = await requireCardAccess(row.cardId, "member", actor);

  const isUploader = row.uploaderId !== null && row.uploaderId === ctx.user.id;
  const isModerator = ctx.role === "admin" || ctx.role === "owner";
  if (!isUploader && !isModerator) {
    throw new AuthorizationError(
      "You can only delete attachments you uploaded.",
    );
  }

  // A concurrent delete may have removed the row since it was read above. Only
  // the request whose DELETE actually removed it logs, touches the board and
  // discards the bytes; the other sees "not found", same as any missing id.
  const deleted = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(cardAttachments)
      .where(eq(cardAttachments.id, input.attachmentId))
      .returning({ id: cardAttachments.id });
    if (removed.length === 0) return false;

    await touchBoard(tx, ctx.board.id);

    await recordActivity(tx, {
      workspaceId: ctx.workspace.id,
      boardId: ctx.board.id,
      cardId: row.cardId,
      actorId: ctx.user.id,
      type: "attachment.deleted",
      data: {
        attachmentId: input.attachmentId,
        filename: row.filename,
        uploaderId: row.uploaderId,
        ...sourceData(source),
      },
    });
    return true;
  });

  if (!deleted) throw new AuthorizationError();

  if (row.storage === "blob" && row.blobPathname) {
    await discardBlobObjects([row.blobPathname], "delete");
  }

  return { boardId: ctx.board.id, cardId: row.cardId };
}

export type OpenedAttachment =
  | { notModified: true; etag: string }
  | {
      notModified: false;
      etag: string;
      filename: string;
      /** The *stored* type. The route passes it through `servedAs`. */
      contentType: string;
      byteSize: number;
      body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>;
    };

/**
 * Resolve an attachment for serving, authorised at the read floor.
 *
 * Conditional requests are answered *after* authorization: a matching
 * `If-None-Match` yields `notModified` only once the caller has been shown to
 * be allowed to read the card, and without touching the bytes. So the browser
 * may keep a copy, but it can never use it without asking first — a signed-out
 * or removed user, or a deleted attachment, gets the 404, never the cache.
 *
 * Returns null when the bytes are gone from the store (the route turns that
 * into the same 404 as "no such attachment"). The private blob URL is never
 * part of the result — the bytes are streamed back through our own route.
 */
export async function openAttachment(
  attachmentId: string,
  actor?: Actor,
  { ifNoneMatch = null }: { ifNoneMatch?: string | null } = {},
): Promise<OpenedAttachment | null> {
  // Only the card id is read before authorization; nothing about the file
  // itself is selected until the caller is known to be allowed to see it.
  const [ref] = await db
    .select({ cardId: cardAttachments.cardId })
    .from(cardAttachments)
    .where(eq(cardAttachments.id, attachmentId))
    .limit(1);

  if (!ref) throw new AuthorizationError();

  await requireCardAccess(ref.cardId, READ_MIN_ROLE, actor);

  const [row] = await db
    .select({
      filename: cardAttachments.filename,
      contentType: cardAttachments.contentType,
      byteSize: cardAttachments.byteSize,
      storage: cardAttachments.storage,
      blobPathname: cardAttachments.blobPathname,
    })
    .from(cardAttachments)
    .where(eq(cardAttachments.id, attachmentId))
    .limit(1);

  if (!row) return null;

  const etag = attachmentETag(attachmentId);
  if (ifNoneMatchHits(ifNoneMatch, etag)) return { notModified: true, etag };

  // Postgres rows hand back the driver's Buffer as-is — it is already a
  // Uint8Array, and `Response` accepts it without another copy. The cast only
  // narrows `ArrayBufferLike`: postgres.js never decodes into shared memory.
  let body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer> | null = null;
  if (row.storage === "blob" && row.blobPathname) {
    body = await getBlobObject(row.blobPathname);
  } else if (row.storage === "postgres") {
    const [bytes] = await db
      .select({ data: cardAttachments.data })
      .from(cardAttachments)
      .where(eq(cardAttachments.id, attachmentId))
      .limit(1);
    body = (bytes?.data ?? null) as Uint8Array<ArrayBuffer> | null;
  }

  if (!body) return null;

  return {
    notModified: false,
    etag,
    filename: row.filename,
    contentType: row.contentType,
    byteSize: row.byteSize,
    body,
  };
}

/**
 * Attachment counts for every card on a board, keyed by card id.
 *
 * Unauthorised by design, like `labelsForBoard`: the caller has already run
 * `requireBoardAccess` for this board id.
 */
export async function attachmentCountsForBoard(
  boardId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ cardId: cardAttachments.cardId, n: count() })
    .from(cardAttachments)
    .where(eq(cardAttachments.boardId, boardId))
    .groupBy(cardAttachments.cardId);

  return new Map(rows.map((r) => [r.cardId, r.n]));
}

/**
 * Blob pathnames for every attachment in a workspace.
 *
 * Deleting a workspace cascades its attachment rows away in SQL, but the
 * bucket knows nothing about foreign keys. The caller (already authorised as
 * the workspace owner) collects these *before* deleting, then discards them.
 */
export async function blobPathnamesForWorkspace(
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ pathname: cardAttachments.blobPathname })
    .from(cardAttachments)
    .innerJoin(boards, eq(boards.id, cardAttachments.boardId))
    .where(
      and(
        eq(boards.workspaceId, workspaceId),
        isNotNull(cardAttachments.blobPathname),
      ),
    );
  return rows.flatMap((r) => (r.pathname ? [r.pathname] : []));
}

/** `del` takes a list; keep each call to a modest batch. */
const BLOB_DELETE_BATCH = 100;

/**
 * Best-effort removal of blob objects whose rows are already gone.
 *
 * Batched, so deleting a large workspace is a handful of requests rather than
 * one enormous one. A failed batch is logged and the rest still run.
 */
export async function discardBlobObjects(pathnames: string[], scope: string) {
  for (let i = 0; i < pathnames.length; i += BLOB_DELETE_BATCH) {
    const batch = pathnames.slice(i, i + BLOB_DELETE_BATCH);
    try {
      await deleteBlobObjects(batch);
    } catch (error) {
      logError(
        `[attachments] ${scope}: blob delete failed; ${batch.length} object(s) orphaned:`,
        error,
      );
    }
  }
}
