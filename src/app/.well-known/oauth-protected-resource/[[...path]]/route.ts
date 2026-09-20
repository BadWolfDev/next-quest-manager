import { metadataCorsOptionsRequestHandler } from "mcp-handler";

import { buildProtectedResourceMetadata, publicOriginFromHeaders } from "@/lib/oauth";

/**
 * RFC 9728 protected resource metadata.
 *
 * This is the document an MCP client finds after a 401 from `/api/mcp`: it
 * says which authorization server to talk to. Mounted on an optional catch-all
 * because clients probe both the bare path and the path-suffixed variant
 * (`/.well-known/oauth-protected-resource/api/mcp`) — RFC 9728 §3.1 defines
 * the suffixed form for resources that live below the origin, and the ones
 * that only try the bare path would otherwise never discover us.
 *
 * Public and unauthenticated by definition. CORS is wide open because
 * browser-based MCP clients fetch it cross-origin before they hold any
 * credential; there is nothing here but three constants and the origin the
 * caller already knows.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = publicOriginFromHeaders(request.headers);

  return Response.json(buildProtectedResourceMetadata(origin), {
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
