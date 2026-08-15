import { z } from "zod";

/**
 * Server-side validation (master prompt §37). Client-side validation reuses
 * these same schemas via React Hook Form, but the server never trusts the
 * client's result — it re-parses.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .max(255, "Email is too long.")
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

/**
 * Password policy. Length is the dominant factor in resistance to offline
 * cracking, so the floor is 12 rather than 8 with a composition rule.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(200, "Password must be at most 200 characters.");

export const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
  rememberMe: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token is required."),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
