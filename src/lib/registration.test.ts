import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `registration.ts` pulls in the Drizzle client for the bootstrap path, and
// `db/index.ts` opens a connection pool as a module side effect. Only the
// config parsing is under test here, so the database is stubbed out.
vi.mock("@/db", () => ({ db: {}, sql: {}, schema: {} }));

/**
 * `getAdminConfig()` memoises its answer in a module-scoped variable — the
 * whole point is that the environment is read once per process. Every case
 * therefore resets the module registry and re-imports.
 */
async function loadRegistration() {
  vi.resetModules();
  return import("./registration");
}

const VALID_PASSWORD = "a-long-enough-password";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("ADMIN_EMAIL", undefined);
  vi.stubEnv("ADMIN_PASSWORD", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAdminConfig — neither variable set", () => {
  it("returns null", async () => {
    const { getAdminConfig } = await loadRegistration();
    expect(getAdminConfig()).toBeNull();
  });

  it("leaves registration open", async () => {
    const { isClosedRegistration } = await loadRegistration();
    expect(isClosedRegistration()).toBe(false);
  });

  it("means nobody is the env admin", async () => {
    const { isEnvAdmin } = await loadRegistration();
    expect(isEnvAdmin("anyone@example.com")).toBe(false);
  });
});

describe("getAdminConfig — both variables set", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", "Admin@Example.COM");
    vi.stubEnv("ADMIN_PASSWORD", VALID_PASSWORD);
  });

  it("returns the normalised email and the raw password", async () => {
    const { getAdminConfig } = await loadRegistration();
    expect(getAdminConfig()).toEqual({
      email: "admin@example.com",
      password: VALID_PASSWORD,
    });
  });

  it("closes registration", async () => {
    const { isClosedRegistration } = await loadRegistration();
    expect(isClosedRegistration()).toBe(true);
  });

  it("memoises: a later env change does not take effect in-process", async () => {
    const { getAdminConfig } = await loadRegistration();
    expect(getAdminConfig()?.email).toBe("admin@example.com");
    vi.stubEnv("ADMIN_EMAIL", "someone-else@example.com");
    expect(getAdminConfig()?.email).toBe("admin@example.com");
  });

  it("tolerates surrounding whitespace in ADMIN_EMAIL", async () => {
    vi.stubEnv("ADMIN_EMAIL", "  admin@example.com  ");
    const { getAdminConfig } = await loadRegistration();
    expect(getAdminConfig()?.email).toBe("admin@example.com");
  });
});

describe("getAdminConfig — exactly one variable set", () => {
  it("throws when only ADMIN_EMAIL is set", async () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    const { getAdminConfig } = await loadRegistration();
    expect(() => getAdminConfig()).toThrow(/must be set together/);
    expect(() => getAdminConfig()).toThrow(/ADMIN_EMAIL only/);
  });

  it("throws when only ADMIN_PASSWORD is set", async () => {
    vi.stubEnv("ADMIN_PASSWORD", VALID_PASSWORD);
    const { getAdminConfig } = await loadRegistration();
    expect(() => getAdminConfig()).toThrow(/must be set together/);
    expect(() => getAdminConfig()).toThrow(/ADMIN_PASSWORD only/);
  });

  it("does not silently leave signup open", async () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    const { isClosedRegistration } = await loadRegistration();
    expect(() => isClosedRegistration()).toThrow();
  });

  it("treats an empty-string ADMIN_EMAIL as unset", async () => {
    vi.stubEnv("ADMIN_EMAIL", "   ");
    vi.stubEnv("ADMIN_PASSWORD", VALID_PASSWORD);
    const { getAdminConfig } = await loadRegistration();
    expect(() => getAdminConfig()).toThrow(/must be set together/);
  });
});

describe("getAdminConfig — invalid values", () => {
  it("rejects a malformed ADMIN_EMAIL", async () => {
    vi.stubEnv("ADMIN_EMAIL", "not-an-email");
    vi.stubEnv("ADMIN_PASSWORD", VALID_PASSWORD);
    const { getAdminConfig } = await loadRegistration();
    expect(() => getAdminConfig()).toThrow(/not a valid email address/);
  });

  it("rejects an ADMIN_PASSWORD below the password policy", async () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("ADMIN_PASSWORD", "short");
    const { getAdminConfig } = await loadRegistration();
    expect(() => getAdminConfig()).toThrow(/does not meet the password policy/);
  });

  it("never echoes the password in the error", async () => {
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("ADMIN_PASSWORD", "hunter2");
    const { getAdminConfig } = await loadRegistration();
    expect(() => getAdminConfig()).toThrow();
    try {
      getAdminConfig();
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2");
    }
  });
});

describe("isEnvAdmin", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("ADMIN_PASSWORD", VALID_PASSWORD);
  });

  it("matches the configured identity case-insensitively", async () => {
    const { isEnvAdmin } = await loadRegistration();
    expect(isEnvAdmin("admin@example.com")).toBe(true);
    expect(isEnvAdmin("  ADMIN@Example.com ")).toBe(true);
  });

  it("rejects anyone else — the `admin` role is not enough", async () => {
    const { isEnvAdmin } = await loadRegistration();
    expect(isEnvAdmin("someone@example.com")).toBe(false);
  });

  it("rejects a missing email", async () => {
    const { isEnvAdmin } = await loadRegistration();
    expect(isEnvAdmin(null)).toBe(false);
    expect(isEnvAdmin(undefined)).toBe(false);
    expect(isEnvAdmin("")).toBe(false);
  });

  it("is false for everyone on an open instance", async () => {
    vi.stubEnv("ADMIN_EMAIL", undefined);
    vi.stubEnv("ADMIN_PASSWORD", undefined);
    const { isEnvAdmin } = await loadRegistration();
    expect(isEnvAdmin("admin@example.com")).toBe(false);
  });
});
