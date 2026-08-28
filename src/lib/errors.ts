/**
 * Error types shared by server and client code.
 *
 * These live apart from `authorize.ts` on purpose: client components need to
 * import `ActionState` helpers that reference them, and pulling in
 * `authorize.ts` would drag the Postgres driver and `@node-rs/argon2` into the
 * browser bundle.
 */

export class AuthorizationError extends Error {
  constructor(message = "You do not have access to this.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "You must be signed in.") {
    super(message);
    this.name = "AuthenticationError";
  }
}
