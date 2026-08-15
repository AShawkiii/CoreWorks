import { describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import {
  capacitySchema,
  changePasswordSchema,
  inviteMemberSchema,
  jobTitleSchema,
  orgRoleSchema,
} from "@/lib/validation/member";

describe("capacitySchema", () => {
  it("treats zero as a real capacity, not as unset", () => {
    // Legacy has a dedicated test for this: a Capacity of exactly 0 is valid
    // and means "overloaded by any open task", while unset means
    // "never judged overloaded" (audit §6.7). Collapsing 0 to null would
    // silently change the workload flag for anyone set to zero.
    expect(capacitySchema.parse(0)).toBe(0);
    expect(capacitySchema.parse("0")).toBe(0);
  });

  it("treats an empty field as unset", () => {
    expect(capacitySchema.parse("")).toBeNull();
  });

  it("accepts whole numbers and rejects fractional or negative ones", () => {
    expect(capacitySchema.parse("25")).toBe(25);
    expect(capacitySchema.safeParse("2.5").success).toBe(false);
    expect(capacitySchema.safeParse("-1").success).toBe(false);
  });

  it("rejects an unrealistically high value", () => {
    expect(capacitySchema.safeParse("100000").success).toBe(false);
  });
});

describe("jobTitleSchema", () => {
  it("normalizes an empty field to null", () => {
    expect(jobTitleSchema.parse("")).toBeNull();
  });

  it("keeps free text — the firm names its own roles", () => {
    // This is the legacy EMPLOYEES.Role used for template assignee
    // resolution (audit §6.10), matched as a string, so it must not be
    // constrained to a fixed enum.
    expect(jobTitleSchema.parse("Senior Accountant")).toBe("Senior Accountant");
    expect(jobTitleSchema.parse("CFO Advisor")).toBe("CFO Advisor");
    expect(jobTitleSchema.parse("  Bookkeeper  ")).toBe("Bookkeeper");
  });
});

describe("orgRoleSchema", () => {
  it("accepts every defined role", () => {
    for (const role of Object.values(OrgRole)) {
      expect(orgRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("rejects an unknown or lowercased role", () => {
    expect(orgRoleSchema.safeParse("SUPERUSER").success).toBe(false);
    expect(orgRoleSchema.safeParse("owner").success).toBe(false);
  });
});

describe("inviteMemberSchema", () => {
  const valid = {
    name: "Priya Raman",
    email: "Priya.Raman@Example.com",
    password: "a-long-enough-password",
    role: OrgRole.ACCOUNTANT,
    jobTitle: "FP&A Analyst",
    department: "Advisory",
    capacity: "20",
  };

  it("accepts a complete invitation and normalizes the email", () => {
    const result = inviteMemberSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe("priya.raman@example.com");
    expect(result.success && result.data.capacity).toBe(20);
  });

  it("enforces the password policy on creation", () => {
    // Unlike sign-in, creation must apply the policy — this is where a weak
    // password would first enter the system.
    expect(
      inviteMemberSchema.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
  });

  it("allows optional fields to be blank", () => {
    const result = inviteMemberSchema.safeParse({
      ...valid,
      jobTitle: "",
      department: "",
      capacity: "",
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.jobTitle).toBeNull();
    expect(result.success && result.data.capacity).toBeNull();
  });

  it("rejects a missing name or malformed email", () => {
    expect(inviteMemberSchema.safeParse({ ...valid, name: "" }).success).toBe(
      false,
    );
    expect(
      inviteMemberSchema.safeParse({ ...valid, email: "not-an-email" }).success,
    ).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  const base = {
    currentPassword: "old-password-value",
    newPassword: "a-long-enough-password",
    confirmPassword: "a-long-enough-password",
  };

  it("accepts a valid change", () => {
    expect(changePasswordSchema.safeParse(base).success).toBe(true);
  });

  it("requires the confirmation to match", () => {
    expect(
      changePasswordSchema.safeParse({
        ...base,
        confirmPassword: "something-else-entirely",
      }).success,
    ).toBe(false);
  });

  it("rejects reusing the current password", () => {
    const same = "a-long-enough-password";
    expect(
      changePasswordSchema.safeParse({
        currentPassword: same,
        newPassword: same,
        confirmPassword: same,
      }).success,
    ).toBe(false);
  });

  it("requires the current password to be supplied", () => {
    expect(
      changePasswordSchema.safeParse({ ...base, currentPassword: "" }).success,
    ).toBe(false);
  });
});
