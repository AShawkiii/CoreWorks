"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { loginSchema } from "@/lib/validation/auth";

export interface LoginState {
  error?: string;
  fieldErrors?: Partial<Record<"email" | "password", string>>;
}

/**
 * Credentials sign-in.
 *
 * Errors are deliberately generic: a wrong password, an unknown email, and a
 * deactivated membership all produce the same message, so this form cannot be
 * used to discover which emails exist. Legacy failed closed for the same
 * reason (audit §10).
 */
export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    rememberMe: formData.get("rememberMe") === "on",
  });

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        email: flattened.email?.[0],
        password: flattened.password?.[0],
      },
    };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    // next-auth signals a successful redirect by throwing; let it through.
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    throw error;
  }

  return {};
}
