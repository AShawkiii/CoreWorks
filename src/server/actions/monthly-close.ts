"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  changeStageStatusSchema,
  openCloseSchema,
  updateCloseSchema,
} from "@/lib/validation/monthly-close";
import { ForbiddenError, requirePermission } from "@/server/tenancy";
import {
  CloseOperationError,
  changeStageStatus,
  openMonthlyClose,
  updateClose,
} from "@/server/services/monthly-close";

import type { FormState } from "./organization";

/**
 * Monthly close server actions.
 *
 * `close:manage` is held by Owner, Admin, Manager, and Accountant — the roles
 * that actually run a close. Team Member and Viewer hold `close:view` only.
 */

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

function refusalMessage(error: unknown): string | null {
  if (error instanceof ForbiddenError || error instanceof CloseOperationError) {
    return error.message;
  }
  return null;
}

function toFormState(error: unknown): FormState {
  const message = refusalMessage(error);
  if (message !== null) return { status: "error", message };
  console.error("Unhandled monthly close action error:", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

/** Carries a refusal back to the page it came from — see actions/tasks.ts. */
function backWithError(pathname: string, message: string): never {
  redirect(
    `${pathname}?error=${encodeURIComponent(message.slice(0, 200))}` as Route,
  );
}

export async function openCloseAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  let openedId: string | null = null;

  try {
    const ctx = await requirePermission("close:manage");

    const parsed = openCloseSchema.safeParse({
      clientId: formData.get("clientId") ?? "",
      period: formData.get("period") ?? "",
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    const close = await openMonthlyClose(
      ctx,
      parsed.data.clientId,
      parsed.data.period,
    );
    openedId = close.id;

    revalidatePath("/monthly-close");
    revalidatePath(`/clients/${parsed.data.clientId}`);
  } catch (error) {
    return toFormState(error);
  }

  // Opening an existing close lands on it rather than erroring — the period is
  // unique per client, so there is only ever one to go to.
  redirect(`/monthly-close/${openedId}`);
}

export async function changeStageStatusAction(
  formData: FormData,
): Promise<void> {
  const parsed = changeStageStatusSchema.safeParse({
    closeId: formData.get("closeId"),
    stageId: formData.get("stageId"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Invalid request.");

  const { closeId, stageId, status } = parsed.data;

  try {
    const ctx = await requirePermission("close:manage");
    await changeStageStatus(ctx, closeId, stageId, status);
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/monthly-close/${closeId}`, message);
  }

  revalidatePath("/monthly-close");
  revalidatePath(`/monthly-close/${closeId}`);
}

export async function updateCloseAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("close:manage");

    const parsed = updateCloseSchema.safeParse({
      closeId: formData.get("closeId") ?? "",
      reviewStatus: formData.get("reviewStatus") ?? "NOT_REVIEWED",
      notes: formData.get("notes") ?? "",
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateClose(
      ctx,
      parsed.data.closeId,
      parsed.data.reviewStatus,
      parsed.data.notes,
    );

    revalidatePath(`/monthly-close/${parsed.data.closeId}`);
    return { status: "success", message: "Close updated." };
  } catch (error) {
    return toFormState(error);
  }
}
