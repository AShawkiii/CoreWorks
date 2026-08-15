"use server";

import { revalidatePath } from "next/cache";

import {
  inviteMemberSchema,
  setMemberActiveSchema,
  updateMemberSchema,
} from "@/lib/validation/member";
import {
  inviteMember,
  MemberOperationError,
  setMemberActive,
  updateMember,
} from "@/server/services/members";
import { ForbiddenError, requirePermission } from "@/server/tenancy";

import type { FormState } from "./organization";

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

function toFormState(error: unknown): FormState {
  if (error instanceof ForbiddenError || error instanceof MemberOperationError) {
    return { status: "error", message: error.message };
  }
  console.error("Unhandled member action error:", error);
  return {
    status: "error",
    message: "Something went wrong. Please try again.",
  };
}

export async function inviteMemberAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    // Permission is checked before anything is read from the form, so an
    // unauthorized caller cannot probe validation behavior.
    const ctx = await requirePermission("member:manage");

    const parsed = inviteMemberSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      role: formData.get("role"),
      jobTitle: formData.get("jobTitle") ?? "",
      department: formData.get("department") ?? "",
      capacity: formData.get("capacity") ?? "",
    });

    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await inviteMember(ctx, parsed.data);
    revalidatePath("/settings/members");
    return { status: "success", message: `${parsed.data.name} added.` };
  } catch (error) {
    return toFormState(error);
  }
}

export async function updateMemberAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("member:manage");

    const parsed = updateMemberSchema.safeParse({
      memberId: formData.get("memberId"),
      name: formData.get("name"),
      role: formData.get("role"),
      jobTitle: formData.get("jobTitle") ?? "",
      department: formData.get("department") ?? "",
      capacity: formData.get("capacity") ?? "",
    });

    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateMember(ctx, parsed.data);
    revalidatePath("/settings/members");
    return { status: "success", message: "Member updated." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function setMemberActiveAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("member:manage");

    const parsed = setMemberActiveSchema.safeParse({
      memberId: formData.get("memberId"),
      isActive: formData.get("isActive") === "true",
    });

    if (!parsed.success) {
      return { status: "error", message: "Invalid request." };
    }

    await setMemberActive(ctx, parsed.data.memberId, parsed.data.isActive);
    revalidatePath("/settings/members");
    return {
      status: "success",
      message: parsed.data.isActive ? "Member reactivated." : "Member deactivated.",
    };
  } catch (error) {
    return toFormState(error);
  }
}

/**
 * Plain-FormData variant for a bare <form action={...}> toggle, which does not
 * carry the useActionState previous-state argument.
 *
 * A refusal here (last Owner, self-deactivation, insufficient seniority) is
 * raised rather than swallowed: the page must not silently appear to succeed.
 * Next.js renders it through the nearest error boundary.
 */
export async function toggleMemberActiveAction(
  formData: FormData,
): Promise<void> {
  const result = await setMemberActiveAction({}, formData);
  if (result.status === "error") {
    throw new Error(result.message ?? "Could not update the member.");
  }
}
