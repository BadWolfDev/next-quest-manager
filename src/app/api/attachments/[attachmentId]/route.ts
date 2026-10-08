import { servedAs } from "@/lib/attachments";
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
 * The headers assume the bytes are hostile:
 *
 *  - Only a magic-byte-sniffed PNG/JPEG/GIF/WebP is served `inline` with its
 *    image type. Everything else — SVG, HTML, PDF, anything unknown — is
 *    `Content-Disposition: attachment` as `application/octet-stream`, so it is
 *    downloaded, never rendered on our origin (`servedAs` decides).
 *  - `nosniff`, so the browser cannot reinterpret either.
 *  - A `default-src 'none'; sandbox` CSP, so even opening the URL directly can
 *    run nothing. Set in `next.config.ts`, not here: the app-wide CSP header
 *    there would override a value set by the handler.
 *
 * Caching: `private, no-cache` plus a strong ETag (the attachment id — its
 * bytes never change). The browser may keep a copy but must revalidate every
 * use, and `If-None-Match` is answered with a 304 only *after* authorization.
 * A signed-out or removed user, or a deleted attachment, therefore gets a 404
 * rather than a cached 200.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  const { attachmentId } = await params;
  const parsed = uuidSchema.safeParse(attachmentId);
  if (!parsed.success) return notFound();

  try {
    const file = await openAttachment(parsed.data, undefined, {
      ifNoneMatch: request.headers.get("if-none-match"),
    });
    if (!file) return notFound();

    const common = {
      ETag: file.etag,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    };

    if (file.notModified) {
      return new Response(null, { status: 304, headers: common });
    }

    const served = servedAs(file.contentType, file.filename);

    // Thumbnails are this same full-size response, scaled by CSS — an accepted
    // cost over running an image-resizing pipeline.
    return new Response(file.body, {
      status: 200,
      headers: {
        ...common,
        "Content-Type": served.contentType,
        "Content-Length": String(file.byteSize),
        "Content-Disposition": served.contentDisposition,
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
    return new Response("Server error", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
