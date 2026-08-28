import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * The middleware runs on the Edge runtime, where `@node-rs/argon2` and the
 * Postgres driver cannot load. This file therefore contains no providers and no
 * database access — just the session strategy, page routes and callbacks that
 * middleware needs. `src/auth.ts` extends it with the credentials provider for
 * the Node runtime.
 */
export const authConfig = {
  // Self-hosted NQM sits behind whatever proxy the operator runs, so the Host
  // header is the only source of truth for the origin. This MUST live here
  // rather than only in `src/auth.ts`: the proxy builds its own Auth.js
  // instance from this config, and without it every request is rejected as
  // UntrustedHost and signed-in users get bounced back to /login.
  trustHost: true,
  // JWT sessions keep NQM serverless-friendly: no session table reads on every
  // request, and no sticky infrastructure.
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
    newUser: "/signup",
    error: "/login",
  },
  // Auth.js already sets httpOnly + sameSite=lax and, on https origins, the
  // `__Secure-`/`__Host-` prefixed secure cookies. Pinned explicitly so a
  // future change cannot silently weaken it.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
        token.email = user.email;
        token.picture = user.image ?? null;
        token.role = (user as { role?: "user" | "admin" }).role ?? "user";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = (token.role as "user" | "admin") ?? "user";
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
