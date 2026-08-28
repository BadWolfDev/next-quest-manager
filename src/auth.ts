import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/auth.config";
import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/lib/env";
import { burnPasswordVerification, verifyPassword } from "@/lib/password";
import {
  AUTH_RATE_LIMIT,
  clientIpFromHeaders,
  rateLimit,
} from "@/lib/rate-limit";
import { signInSchema } from "@/lib/validation";

/**
 * Node-runtime Auth.js instance: credentials provider, Postgres lookups,
 * argon2id verification.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: env.AUTH_SECRET,
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Throttle per IP + email so neither a single account nor a single
        // source address can be brute-forced. Fails closed.
        const ip = clientIpFromHeaders(new Headers(request.headers));
        const limited = await rateLimit({
          key: `login:${ip}:${email}`,
          ...AUTH_RATE_LIMIT,
        });
        if (!limited.ok) {
          throw new Error(
            "Too many sign-in attempts. Try again in a few minutes.",
          );
        }

        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            image: users.image,
            role: users.role,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user) {
          // Spend the same argon2id budget as a real verification so response
          // time does not disclose whether the account exists.
          await burnPasswordVerification(password);
          return null;
        }

        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});
