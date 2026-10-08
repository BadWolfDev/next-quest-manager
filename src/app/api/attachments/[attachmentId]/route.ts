import { contentDispositionInline } from "@/lib/attachments";
import { openAttachment } from "@/lib/core/attachments";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { logError } from "@/lib/log-error";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve an attachment's bytes to someone who may read its card.
 *
 * Authorised through `requireCardAccess` at the read floor (inside
 * `openAttachment`); no access, no such id and a missing object are the same
 * 404. Bytes are streamed from wherever the *row* says they live — Postgres or
 * the private blob store — and the store's own URL never reaches the client.
 *
 * The headers assume the bytes are hostile even though they were sniffed on
 * the way in: the stored sniffed type (never re-derived), `nosniff` so the
 * browser cannot reinterpret it, and a `default-src 'none'; sandbox` CSP so
 * that even opening the URL directly can run nothing. The CSP is set in
 * `next.config.ts`, not here: the app-wide CSP header there would override a
 * value set by the handler.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params;
  const parsed = uuidSchema.safeParse(attachmentId);
  if (!parsed.success) return notFound();

  try {
    const file = await openAttachment(parsed.data);
    if (!file) return notFound();

    // Thumbnails are this same full-size response, scaled by CSS. Capped at a
    // few MB per image and cached privately, that is an accepted cost over
    // running an image-resizing pipeline.
    return new Response(file.body, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.byteSize),
        "Content-Disposition": contentDispositionInline(file.filename),
        "X-Content-Type-Options": "nosniff",
        // Per-user content behind a session: browser cache only, never a
        // shared one. An attachment is immutable, so an hour is safe; access
        // revocation lags by at most that much on a device that already saw it.
        "Cache-Control": "private, max-age=3600",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    if (
      error instanceof AuthorizationError ||
      error instanceof AuthenticationError
    ) {
      return notFound();
    }
    logError("[attachments:serve]", error);
    return new Response("Server error", { status: 500 });
  }
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
