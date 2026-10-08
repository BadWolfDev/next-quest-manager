import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";

/**
 * Route protection (Next.js 16 `proxy`, formerly `middleware`).
 *
 * This only reads the signed session cookie to decide where to send a request —
 * it is a redirect layer, never an authorization decision. Real authorization
 * lives in `src/lib/authorize.ts` and is re-checked inside every server action
 * and data query.
 */
const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set(["/", "/login", "/signup"]);

/**
 * Invite links must render for signed-out visitors — that is the whole point of
 * a shareable link. The page itself decides what to show; joining still
 * requires an authenticated session.
 */
const PUBLIC_PREFIXES = ["/invite/", "/join/", "/p/", "/api/session/"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isSignedIn = Boolean(req.auth?.user);
  const isPublic =
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!isSignedIn && !isPublic) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (isSignedIn && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/app", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Everything except Next internals, static assets, the Auth.js endpoints,
     * the MCP endpoint, the cron endpoints and the OAuth machinery.
     *
     * `/api/mcp` and `/api/cron/*` authenticate with a bearer token, not a
     * session cookie. If they were matched here, every such request would be
     * answered with a 307 to /login instead of the 401 the caller expects —
     * and the cron sweep would never reach its handler at all.
     *
     * `/.well-known/*` and `/api/oauth/*` are the OAuth discovery, registration
     * and token endpoints. They are called by machines with no cookie jar, so a
     * 307 to /login would break discovery entirely.
     *
     * `/api/attachments/*` authorises every request itself (a 404 for anyone
     * who may not see the card) and must not be matched: when the proxy runs,
     * Next.js clones the request body and reads it to the end before the
     * handler is invoked. The upload route is built to refuse an outsider, a
     * viewer, a full card or an oversized Content-Length *before* reading the
     * body; matched here, every one of those would first cost a full upload.
     *
     * `/oauth/authorize` is deliberately **not** exempt: it is the one OAuth
     * surface that needs a human, and being matched here is exactly what sends
     * a signed-out visitor to /login?next=… with the authorization request
     * intact.
     */
    "/((?!api/auth|api/mcp|api/cron|api/oauth|api/public|api/attachments|\\.well-known|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
