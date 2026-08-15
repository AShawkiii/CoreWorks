import { describe, expect, it } from "vitest";

import {
  credentialsSchema,
  emailSchema,
  loginSchema,
  passwordSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

describe("emailSchema", () => {
  it("normalizes case and surrounding whitespace", () => {
    // Legacy lowercased and trimmed before matching EMPLOYEES (audit §10);
    // sign-in must not be case-sensitive.
    expect(emailSchema.parse("  Amara.Okafor@Example.COM  ")).toBe(
      "amara.okafor@example.com",
    );
  });

  it("rejects malformed addresses", () => {
    for (const value of ["", "not-an-email", "a@", "@b.com", "a b@c.com"]) {
      expect(emailSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects an over-long address", () => {
    expect(
      emailSchema.safeParse(`${"a".repeat(250)}@example.com`).success,
    ).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("requires at least 12 characters", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("elevenchars").success).toBe(false);
    expect(passwordSchema.safeParse("twelvechars!").success).toBe(true);
  });

  it("accepts a long passphrase without composition rules", () => {
    expect(
      passwordSchema.safeParse("correct horse battery staple").success,
    ).toBe(true);
  });

  it("rejects an absurdly long value", () => {
    expect(passwordSchema.safeParse("a".repeat(201)).success).toBe(false);
  });
});

describe("credentialsSchema", () => {
  it("accepts a well-formed pair", () => {
    const result = credentialsSchema.safeParse({
      email: "USER@Example.com",
      password: "anything-nonempty",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("user@example.com");
  });

  it("does not enforce the password policy on sign-in", () => {
    // Applying the 12-char minimum here would reject legitimate existing
    // passwords and leak the policy to an attacker probing the endpoint.
    expect(
      credentialsSchema.safeParse({ email: "a@b.com", password: "old" })
        .success,
    ).toBe(true);
  });

  it("rejects a missing password", () => {
    expect(
      credentialsSchema.safeParse({ email: "a@b.com", password: "" }).success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("defaults rememberMe to false", () => {
    const result = loginSchema.parse({
      email: "a@b.com",
      password: "secret",
    });
    expect(result.rememberMe).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires the confirmation to match", () => {
    const result = resetPasswordSchema.safeParse({
      token: "tok",
      password: "a-long-enough-password",
      confirmPassword: "a-different-password",
    });
    expect(result.success).toBe(false);
    expect(
      result.success ||
        result.error.issues.some((issue) =>
          issue.path.includes("confirmPassword"),
        ),
    ).toBe(true);
  });

  it("accepts a matching pair with a token", () => {
    expect(
      resetPasswordSchema.safeParse({
        token: "tok",
        password: "a-long-enough-password",
        confirmPassword: "a-long-enough-password",
      }).success,
    ).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(
      resetPasswordSchema.safeParse({
        token: "",
        password: "a-long-enough-password",
        confirmPassword: "a-long-enough-password",
      }).success,
    ).toBe(false);
  });
});
