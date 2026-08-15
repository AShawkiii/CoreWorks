"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { commentSchema, deleteCommentSchema } from "@/lib/validation/comment";
import {
  changeRequestStatusSchema,
  createRequestSchema,
  updateRequestSchema,
} from "@/lib/validation/request";
import {
  ForbiddenError,
  requireOrgContext,
  requirePermission,
} from "@/server/tenancy";
import {
  CommentOperationError,
  addComment,
  deleteComment,
} from "@/server/services/comments";
import {
  RequestOperationError,
  changeRequestStatus,
  createRequest,
  updateRequest,
} from "@/server/services/requests";

import type { FormState } from "./organization";

/**
 * Client request server actions.
 *
 * Same shape as the issue actions: `request:update` is flat across every role
 * except Viewer, so a permission check is the whole decision.
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
  if (
    error instanceof ForbiddenError ||
    error instanceof RequestOperationError ||
    error instanceof CommentOperationError
  ) {
    return error.message;
  }
  return null;
}

function toFormState(error: unknown): FormState {
  const message = refusalMessage(error);
  if (message !== null) return { status: "error", message };
  console.error("Unhandled request action error:", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

function backWithError(pathname: string, message: string): never {
  redirect(
    `${pathname}?error=${encodeURIComponent(message.slice(0, 200))}` as Route,
  );
}

function payloadFrom(formData: FormData) {
  return {
    clientId: formData.get("clientId") ?? "",
    title: formData.get("title") ?? "",
    description: formData.get("description") ?? "",
    priority: formData.get("priority") ?? "MEDIUM",
    assignedToId: formData.get("assignedToId") ?? "",
    requestedDate: formData.get("requestedDate") ?? "",
    requiredBy: formData.get("requiredBy") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

export async function createRequestAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | null = null;

  try {
    const ctx = await requirePermission("request:create");

    const parsed = createRequestSchema.safeParse(payloadFrom(formData));
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    const created = await createRequest(ctx, parsed.data);
    createdId = created.id;

    revalidatePath("/requests");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/dashboard");
  } catch (error) {
    return toFormState(error);
  }

  redirect(`/requests/${createdId}`);
}

export async function updateRequestAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("request:update");

    const parsed = updateRequestSchema.safeParse({
      requestId: formData.get("requestId") ?? "",
      ...payloadFrom(formData),
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateRequest(ctx, parsed.data);

    revalidatePath("/requests");
    revalidatePath(`/requests/${parsed.data.requestId}`);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { status: "success", message: "Request updated." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function changeRequestStatusAction(
  formData: FormData,
): Promise<void> {
  const parsed = changeRequestStatusSchema.safeParse({
    requestId: formData.get("requestId"),
    status: formData.get("status"),
    receivedDate: formData.get("receivedDate") ?? "",
    resolution: formData.get("resolution") ?? "",
  });
  if (!parsed.success) throw new Error("Invalid request.");

  const { requestId, status, receivedDate, resolution } = parsed.data;

  try {
    const ctx = await requirePermission("request:update");
    await changeRequestStatus(ctx, requestId, status, {
      receivedDate,
      resolution,
    });
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/requests/${requestId}`, message);
  }

  revalidatePath("/requests");
  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/dashboard");
}

export async function addRequestCommentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const parsed = commentSchema.safeParse({
      parentId: formData.get("requestId"),
      body: formData.get("body"),
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    const ctx = await requireOrgContext();
    await addComment(ctx, "request", parsed.data.parentId, parsed.data.body);

    revalidatePath(`/requests/${parsed.data.parentId}`);
    return { status: "success" };
  } catch (error) {
    return toFormState(error);
  }
}

export async function deleteRequestCommentAction(
  formData: FormData,
): Promise<void> {
  const parsed = deleteCommentSchema.safeParse({
    parentId: formData.get("requestId"),
    commentId: formData.get("commentId"),
  });
  if (!parsed.success) throw new Error("Invalid request.");

  const { parentId, commentId } = parsed.data;

  try {
    const ctx = await requireOrgContext();
    await deleteComment(ctx, "request", parentId, commentId);
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/requests/${parentId}`, message);
  }

  revalidatePath(`/requests/${parentId}`);
}
