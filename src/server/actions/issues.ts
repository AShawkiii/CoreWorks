"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { commentSchema, deleteCommentSchema } from "@/lib/validation/comment";
import {
  changeIssueStatusSchema,
  createIssueSchema,
  updateIssueSchema,
} from "@/lib/validation/issue";
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
  IssueOperationError,
  changeIssueStatus,
  createIssue,
  updateIssue,
} from "@/server/services/issues";

import type { FormState } from "./organization";

/**
 * Issue server actions.
 *
 * Unlike tasks, issue editing has no assignee-dependent tier: the Phase 2
 * matrix gives every role except Viewer a flat `issue:update`, so a plain
 * permission check is the whole decision. That is not an oversight — legacy
 * had no per-assignee restriction on issues either, and Phase 2's RBAC is not
 * changed without a concrete requirement proving it wrong.
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
    error instanceof IssueOperationError ||
    error instanceof CommentOperationError
  ) {
    return error.message;
  }
  return null;
}

function toFormState(error: unknown): FormState {
  const message = refusalMessage(error);
  if (message !== null) return { status: "error", message };
  console.error("Unhandled issue action error:", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

/** Carries a refusal back to the page it came from — see actions/tasks.ts. */
function backWithError(pathname: string, message: string): never {
  redirect(
    `${pathname}?error=${encodeURIComponent(message.slice(0, 200))}` as Route,
  );
}

function payloadFrom(formData: FormData) {
  return {
    clientId: formData.get("clientId") ?? "",
    title: formData.get("title") ?? "",
    category: formData.get("category") ?? "",
    impact: formData.get("impact") ?? "",
    description: formData.get("description") ?? "",
    severity: formData.get("severity") ?? "MEDIUM",
    assignedToId: formData.get("assignedToId") ?? "",
    dateRaised: formData.get("dateRaised") ?? "",
    deadline: formData.get("deadline") ?? "",
    requiredAction: formData.get("requiredAction") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

export async function createIssueAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | null = null;

  try {
    const ctx = await requirePermission("issue:create");

    const parsed = createIssueSchema.safeParse(payloadFrom(formData));
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    const created = await createIssue(ctx, parsed.data);
    createdId = created.id;

    revalidatePath("/issues");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/dashboard");
  } catch (error) {
    return toFormState(error);
  }

  redirect(`/issues/${createdId}`);
}

export async function updateIssueAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("issue:update");

    const parsed = updateIssueSchema.safeParse({
      issueId: formData.get("issueId") ?? "",
      ...payloadFrom(formData),
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateIssue(ctx, parsed.data);

    revalidatePath("/issues");
    revalidatePath(`/issues/${parsed.data.issueId}`);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/dashboard");
    return { status: "success", message: "Issue updated." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function changeIssueStatusAction(
  formData: FormData,
): Promise<void> {
  const parsed = changeIssueStatusSchema.safeParse({
    issueId: formData.get("issueId"),
    status: formData.get("status"),
    resolutionDate: formData.get("resolutionDate") ?? "",
    resolution: formData.get("resolution") ?? "",
  });
  if (!parsed.success) throw new Error("Invalid request.");

  const { issueId, status, resolutionDate, resolution } = parsed.data;

  try {
    const ctx = await requirePermission("issue:update");
    await changeIssueStatus(ctx, issueId, status, {
      resolutionDate,
      resolution,
    });
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/issues/${issueId}`, message);
  }

  revalidatePath("/issues");
  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/dashboard");
}

export async function addIssueCommentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const parsed = commentSchema.safeParse({
      parentId: formData.get("issueId"),
      body: formData.get("body"),
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    // Commenting needs read access, not edit rights.
    const ctx = await requireOrgContext();
    await addComment(ctx, "issue", parsed.data.parentId, parsed.data.body);

    revalidatePath(`/issues/${parsed.data.parentId}`);
    return { status: "success" };
  } catch (error) {
    return toFormState(error);
  }
}

export async function deleteIssueCommentAction(
  formData: FormData,
): Promise<void> {
  const parsed = deleteCommentSchema.safeParse({
    parentId: formData.get("issueId"),
    commentId: formData.get("commentId"),
  });
  if (!parsed.success) throw new Error("Invalid request.");

  const { parentId, commentId } = parsed.data;

  try {
    const ctx = await requireOrgContext();
    await deleteComment(ctx, "issue", parentId, commentId);
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/issues/${parentId}`, message);
  }

  revalidatePath(`/issues/${parentId}`);
}
