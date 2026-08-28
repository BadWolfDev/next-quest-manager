import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drop a session whose user no longer exists, then send the visitor to login.
 *
 * This route exists because clearing the cookie is the only way to break an
 * otherwise infinite bounce: the JWT still *verifies*, so the proxy believes
 * the visitor is signed in and redirects /login -> /app, while the app shell
 * finds no matching user row and redirects /app -> /login. Server Components
 * cannot mutate cookies; a Route Handler can, so the redirect goes through
 * here and the stale cookie is deleted on the way past.
 *
 * Deleting by prefix covers both the dev (`authjs.*`) and production
 * (`__Secure-authjs.*`) cookie names without hard-coding either.
 */
export async function GET(request: Request) {
  const store = await cookies();

  for (const cookie of store.getAll()) {
    if (!cookie.name.includes("authjs")) continue;

    /*
      Overwrite with an expired value rather than calling delete().
      delete() emits a Set-Cookie without the Secure attribute, and a browser
      rejects any Set-Cookie for a `__Secure-` prefixed name that lacks it —
      so in production the cookie survived and /app <-> /login bounced forever.
      Re-stating the original attributes is what makes the removal stick.
    */
    store.set(cookie.name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: cookie.name.startsWith("__Secure-"),
    });
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("expired", "1");
  return NextResponse.redirect(url);
}
