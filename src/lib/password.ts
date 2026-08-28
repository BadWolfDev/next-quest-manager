import "server-only";

import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id parameters. OWASP's 2024 baseline for argon2id is 19 MiB memory,
 * t=2, p=1 — comfortable on a Vercel function and on a small self-hosted box.
 */
const ARGON2_OPTIONS = {
  // 2 = Argon2id
  algorithm: 2 as const,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * A hash of a random string, computed once per process. Used to burn the same
 * CPU time when an email does not exist, so login timing does not reveal which
 * accounts are registered.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash(
    `nqm-timing-decoy-${crypto.randomUUID()}`,
    ARGON2_OPTIONS,
  );
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2_OPTIONS);
  } catch {
    // Malformed hash in the DB — treat as a failed login, never as a pass.
    return false;
  }
}

/**
 * Constant-work stand-in for "user not found". Always await this on the
 * unknown-email path so an attacker cannot enumerate accounts by response time.
 */
export async function burnPasswordVerification(password: string): Promise<void> {
  try {
    await verify(await getDummyHash(), password, ARGON2_OPTIONS);
  } catch {
    /* the decoy never matches; the point is the elapsed work */
  }
}
