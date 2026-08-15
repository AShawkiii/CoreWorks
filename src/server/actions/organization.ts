"use server";

import { revalidatePath } from "next/cache";

import { updateOrganizationSchema } from "@/lib/validation/organization";
import {
  changePasswordSchema,
  updateProfileSchema,
} from "@/lib/validation/member";
import { MemberOperationError } from "@/server/services/members";
import {
  changeOwnPassword,
  updateOrganization,
  updateOwnProfile,
} from "@/server/services/organization";
import { ForbiddenError, requireOrgContext, requirePermission } from "@/server/tenancy";

export interface FormState {
  status?: "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Flattens a Zod error into the shape the forms render. */
function fieldErrorsFrom(
  flattened: Record<string, string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(flattened)) {
    const first = messages?.[0];
    if (first) result[key] = first;
  }
  return result;
}

/**
 * Converts a thrown error into a message safe to show a user.
 *
 * Anything unrecognised becomes a generic message and is logged server-side —
 * raw database errors must never reach the browser (master prompt §45).
 */
function toFormState(error: unknown): FormState {
  if (error instanceof ForbiddenError || error instanceof MemberOperationError) {
    return { status: "error", message: error.message };
  }
  console.error("Unhandled action error:", error);
  return {
    status: "error",
    message: "Something went wrong. Please try again.",
  };
}

export async function updateOrganizationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("org:manage");

    const parsed = updateOrganizationSchema.safeParse({
      name: formData.get("name"),
      slug: formData.get("slug"),
      logoUrl: formData.get("logoUrl") ?? "",
      timezone: formData.get("timezone"),
      currency: formData.get("currency"),
      locale: formData.get("locale"),
    });

    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateOrganization(ctx, parsed.data);
    revalidatePath("/settings/organization");
    return { status: "success", message: "Organization updated." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateProfileAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requireOrgContext();

    const parsed = updateProfileSchema.safeParse({
      name: formData.get("name"),
    });

    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateOwnProfile(ctx, parsed.data.name);
    revalidatePath("/settings/profile");
    return { status: "success", message: "Profile updated." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function changePasswordAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requireOrgContext();

    const parsed = changePasswordSchema.safeParse({
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await changeOwnPassword(
      ctx,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    return { status: "success", message: "Password changed." };
  } catch (error) {
    return toFormState(error);
  }
}
