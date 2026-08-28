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
const PUBLIC_PREFIXES = ["/invite/", "/p/", "/api/session/"];

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
     * and the MCP endpoint.
     *
     * `/api/mcp` authenticates with a bearer token, not a session cookie. If it
     * were matched here, every MCP request would be answered with a 307 to
     * /login instead of the 401 the protocol expects.
     */
    "/((?!api/auth|api/mcp|api/public|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
