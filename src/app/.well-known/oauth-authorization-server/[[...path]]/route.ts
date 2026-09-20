import { metadataCorsOptionsRequestHandler } from "mcp-handler";

import {
  buildAuthorizationServerMetadata,
  publicOriginFromHeaders,
} from "@/lib/oauth";

/**
 * RFC 8414 authorization server metadata.
 *
 * Next Quest Manager is its own authorization server, so the issuer is simply
 * this instance's origin and every endpoint below lives in this repo. An
 * operator who deploys the app gets a working OAuth server with no extra
 * service and no extra environment variable — the origin is read from the
 * request, so the same image serves a Vercel preview, a custom domain and
 * `localhost:3000` correctly.
 *
 * Mounted on an optional catch-all for the same reason as the protected
 * resource document: some clients append the resource path to the well-known
 * URL before trying the bare one.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = publicOriginFromHeaders(request.headers);

  return Response.json(buildAuthorizationServerMetadata(origin), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      // Not cacheable: the whole document is derived from the Host the
      // request arrived on, and a shared cache in front of an instance that
      // answers on more than one hostname would hand one origin's metadata to
      // a client that asked another.
      "Cache-Control": "no-store",
    },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
