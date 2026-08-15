import { z } from "zod";

import { OrgRole } from "@/generated/prisma/enums";
import { emailSchema, passwordSchema } from "@/lib/validation/auth";

/**
 * Organization member validation (master prompt §9/§37).
 *
 * `jobTitle` is the legacy `EMPLOYEES.Role` (audit §6.10) and stays free text
 * — the firm can name its own roles, and template assignee resolution matches
 * on the string. It is NOT the access-control role, which is `role` below.
 */

export const orgRoleSchema = z.enum(
  Object.values(OrgRole) as [OrgRole, ...OrgRole[]],
);

export const memberNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(120, "Name is too long.");

export const jobTitleSchema = z
  .union([z.literal(""), z.string().trim().max(80, "Job title is too long.")])
  .transform((value) => (value === "" ? null : value));

export const departmentSchema = z
  .union([z.literal(""), z.string().trim().max(80, "Department is too long.")])
  .transform((value) => (value === "" ? null : value));

/**
 * Legacy `EMPLOYEES.Capacity` — the open-task count above which a member is
 * flagged overloaded (audit §6.7).
 *
 * Empty means "unset", which legacy treated as "never judged overloaded".
 * Zero is a real, valid capacity and must NOT collapse to unset — legacy has
 * a dedicated test for exactly that distinction.
 */
export const capacitySchema = z
  .union([
    z.literal(""),
    z.coerce
      .number()
      .int("Capacity must be a whole number.")
      .min(0, "Capacity cannot be negative.")
      .max(1000, "Capacity is unrealistically high."),
  ])
  .transform((value) => (value === "" ? null : value));

export const inviteMemberSchema = z.object({
  name: memberNameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: orgRoleSchema,
  jobTitle: jobTitleSchema,
  department: departmentSchema,
  capacity: capacitySchema,
});

export const updateMemberSchema = z.object({
  memberId: z.string().uuid("Invalid member."),
  name: memberNameSchema,
  role: orgRoleSchema,
  jobTitle: jobTitleSchema,
  department: departmentSchema,
  capacity: capacitySchema,
});

export const setMemberActiveSchema = z.object({
  memberId: z.string().uuid("Invalid member."),
  isActive: z.boolean(),
});

export const updateProfileSchema = z.object({
  name: memberNameSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must differ from the current one.",
    path: ["newPassword"],
  });

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
