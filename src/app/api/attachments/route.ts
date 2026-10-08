import { NextResponse } from "next/server";

import { MAX_UPLOAD_REQUEST_BYTES } from "@/lib/attachments";
import { tooLargeMessage, uploadAttachment } from "@/lib/core/attachments";
import {
  AuthenticationError,
  AuthorizationError,
  UploadRejectedError,
} from "@/lib/errors";
import { logError } from "@/lib/log-error";
import { publicOriginFromHeaders } from "@/lib/oauth";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload one file — any type — to a card: `POST /api/attachments?cardId=<uuid>`
 * with a `multipart/form-data` body carrying a single `file` part. The one
 * upload path for both storage backends.
 *
 * Why a route handler and not a server action:
 *
 *  - Server actions share ONE body cap (`serverActions.bodySizeLimit`, 1 MB by
 *    default). Raising it to fit a 4.4 MB file would raise it for every action
 *    in the app — every one of which is a public endpoint. A route handler
 *    keeps the large-body allowance on this single URL.
 *  - A server action's body is parsed by the framework before our code runs.
 *    Here `uploadAttachment` authorises the caller, rate-limits them and checks
 *    the card has room *first*, and only then calls back into `readFile` — so an
 *    outsider or a viewer never makes the server buffer a few megabytes.
 *    (Which is also why `/api/attachments` is outside the `proxy.ts` matcher:
 *    the proxy reads the whole body before any handler runs.)
 *  - Content-Length is checked against the request-body ceiling
 *    (`MAX_UPLOAD_REQUEST_BYTES`, Vercel's limit) before the body is read, and
 *    the parsed file against the per-file cap after. Node reads no more than
 *    the declared Content-Length, so a header that understates the body cannot
 *    smuggle in more.
 *
 * Route handlers get none of the server-action CSRF protection, so the same
 * Origin-vs-Host check is done by hand below. Auth.js's SameSite=Lax session
 * cookie already keeps cross-site POSTs anonymous; this is the second lock.
 *
 * Errors: anything authorization-shaped is a 404 — the card's existence is not
 * disclosed. Upload rejections carry a user-safe message for the toast.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = uuidSchema.safeParse(
    new URL(request.url).searchParams.get("cardId"),
  );
  if (!parsed.success) return notFound();

  try {
    const { attachment } = await uploadAttachment(
      {
        cardId: parsed.data,
        readFile: (maxBytes) => readSingleFile(request, maxBytes),
      },
      { source: "ui" },
    );

    return NextResponse.json(
      {
        attachment: {
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          byteSize: attachment.byteSize,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      return NextResponse.json(
        { error: "rejected", message: error.message },
        { status: error.status },
      );
    }
    if (
      error instanceof AuthorizationError ||
      error instanceof AuthenticationError
    ) {
      return notFound();
    }
    logError("[attachments:upload]", error);
    return NextResponse.json(
      { error: "server_error", message: "Upload failed. Please try again." },
      { status: 500 },
    );
  }
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

/**
 * Refuse a cross-origin POST. Mirrors Next.js's own server-action check:
 * `Origin` must be present and its host must match the host this request
 * arrived on — `X-Forwarded-Host` (Vercel, a reverse proxy) or `Host`, derived
 * by the same `publicOriginFromHeaders` the OAuth server uses.
 *
 * Only the host is compared, not the scheme. That function *guesses* the
 * scheme (https unless localhost or `X-Forwarded-Proto` says otherwise), and a
 * self-hosted container answering plain http on a LAN address would otherwise
 * reject its own uploads. The host is what the browser cannot be made to lie
 * about cross-site, and it is what Next.js compares too.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || !request.headers.get("host")) return false;
  try {
    return (
      new URL(origin).host ===
      new URL(publicOriginFromHeaders(request.headers)).host
    );
  } catch {
    return false;
  }
}

async function readSingleFile(request: Request, maxBytes: number) {
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) {
    throw new UploadRejectedError("Upload size unknown.", 411);
  }
  if (declared > MAX_UPLOAD_REQUEST_BYTES) {
    throw new UploadRejectedError(tooLargeMessage(maxBytes), 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new UploadRejectedError("That upload could not be read.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new UploadRejectedError("Choose a file to upload.");
  }
  if (file.size > maxBytes) {
    throw new UploadRejectedError(tooLargeMessage(maxBytes), 413);
  }

  return {
    filename: file.name,
    // A view over the parsed file's buffer — no copy.
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}
