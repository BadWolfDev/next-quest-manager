import { describe, expect, it } from "vitest";

import {
  boardNameSchema,
  cardTitleSchema,
  emailSchema,
  fieldErrors,
  hexColorSchema,
  nameSchema,
  passwordSchema,
  signInSchema,
  signUpSchema,
  slugify,
  uuidSchema,
} from "./validation";

describe("uuidSchema", () => {
  it("accepts a v4 UUID", () => {
    const id = "3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
    expect(uuidSchema.parse(id)).toBe(id);
  });

  it("rejects the ids a URL might otherwise smuggle in", () => {
    for (const bad of [
      "1",
      "not-a-uuid",
      "3f1b2c4d5e6f4a8b9c0d1e2f3a4b5c6d",
      "3f1b2c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d ",
      "'; drop table cards; --",
      "",
    ]) {
      expect(uuidSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("reports the generic message — ids never explain themselves", () => {
    const result = uuidSchema.safeParse("nope");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Invalid id.");
    }
  });
});

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "ada", "ada@", "@example.com", "a b@example.com"]) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("rejects an address over 254 characters", () => {
    expect(
      emailSchema.safeParse(`${"a".repeat(250)}@example.com`).success,
    ).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("requires at least 10 characters", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("0123456789").success).toBe(true);
  });

  it("caps the length so argon2 is never handed a megabyte", () => {
    expect(passwordSchema.safeParse("x".repeat(201)).success).toBe(false);
  });

  it("does not trim — whitespace is part of a password", () => {
    expect(passwordSchema.parse("  spaces  ok  ")).toBe("  spaces  ok  ");
  });
});

describe("name and title schemas", () => {
  it("trims and requires content", () => {
    expect(nameSchema.parse("  Ada  ")).toBe("Ada");
    expect(nameSchema.safeParse("   ").success).toBe(false);
  });

  it("enforces their upper bounds", () => {
    expect(nameSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(boardNameSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(cardTitleSchema.safeParse("x".repeat(501)).success).toBe(false);
    expect(cardTitleSchema.safeParse("x".repeat(500)).success).toBe(true);
  });
});

describe("hexColorSchema", () => {
  it("accepts 3- and 6-digit hex in either case", () => {
    for (const ok of ["#fff", "#FFF", "#a1b2c3", "#A1B2C3"]) {
      expect(hexColorSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const bad of ["fff", "#ff", "#ffff", "#gggggg", "red", "#fff "]) {
      expect(hexColorSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("signUpSchema / signInSchema", () => {
  it("normalises a whole sign-up payload", () => {
    expect(
      signUpSchema.parse({
        name: " Ada ",
        email: " Ada@Example.com ",
        password: "correct horse battery",
      }),
    ).toEqual({
      name: "Ada",
      email: "ada@example.com",
      password: "correct horse battery",
    });
  });

  it("sign-in only requires a non-empty password", () => {
    expect(
      signInSchema.safeParse({ email: "ada@example.com", password: "x" })
        .success,
    ).toBe(true);
    expect(
      signInSchema.safeParse({ email: "ada@example.com", password: "" })
        .success,
    ).toBe(false);
  });
});

describe("fieldErrors", () => {
  it("collapses a ZodError to one message per field", () => {
    const result = signUpSchema.safeParse({
      name: "",
      email: "nope",
      password: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(["email", "name", "password"]);
      expect(errors.name).toBe("Enter your name.");
    }
  });

  it("keeps the first message when a field has several issues", () => {
    const result = signUpSchema.safeParse({
      name: "Ada",
      email: "",
      password: "x",
    });
    if (!result.success) {
      const emailIssues = result.error.issues.filter(
        (i) => i.path[0] === "email",
      );
      expect(fieldErrors(result.error).email).toBe(emailIssues[0].message);
    }
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Team Workspace")).toBe("my-team-workspace");
  });

  it("strips accents", () => {
    expect(slugify("Café Crème")).toBe("cafe-creme");
  });

  it("collapses runs of punctuation and trims the edges", () => {
    expect(slugify("  --Hello, World!!  ")).toBe("hello-world");
  });

  it("caps the length at 40 characters", () => {
    expect(slugify("a".repeat(100))).toHaveLength(40);
  });

  it("never returns an empty slug", () => {
    expect(slugify("")).toBe("workspace");
    expect(slugify("!!!")).toBe("workspace");
    expect(slugify("日本語")).toBe("workspace");
  });

  it("produces a URL-safe result", () => {
    expect(slugify("Ünïcødé & Spaces / Slashes")).toMatch(/^[a-z0-9-]+$/);
  });
});
