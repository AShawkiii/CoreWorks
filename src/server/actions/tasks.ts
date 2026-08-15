"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  bulkReassignSchema,
  bulkStatusSchema,
  changeTaskStatusSchema,
  createTaskSchema,
  deleteTaskCommentSchema,
  taskCommentSchema,
  updateTaskSchema,
} from "@/lib/validation/task";
import { ForbiddenError, requireOrgContext, requirePermission } from "@/server/tenancy";
import { canUpdateTask } from "@/server/auth/permissions";
import { prisma } from "@/lib/db";
import {
  addTaskComment,
  bulkReassign,
  bulkUpdateStatus,
  deleteTask,
  deleteTaskComment,
  updateTaskDetails,
} from "@/server/services/task-mutations";
import {
  createTask,
  TaskOperationError,
  updateTaskStatus,
} from "@/server/services/tasks";

import type { FormState } from "./organization";

/**
 * Task server actions.
 *
 * Task editing has a second layer beyond the permission matrix: a Team Member
 * holds `task:update_own` rather than `task:update`, so the check depends on
 * whether they are the assignee. `requireTaskPermission` resolves that, and
 * every mutating action goes through it.
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

function toFormState(error: unknown): FormState {
  if (error instanceof ForbiddenError || error instanceof TaskOperationError) {
    return { status: "error", message: error.message };
  }
  console.error("Unhandled task action error:", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

/**
 * Authorizes editing one specific task.
 *
 * `task:update` covers any task. `task:update_own` covers only a task the
 * caller is assigned to — so the assignee has to be resolved before the
 * decision, which a static permission check cannot do.
 */
async function requireTaskPermission(taskId: string) {
  const ctx = await requireOrgContext();

  const task = await prisma.task.findFirst({
    where: { id: taskId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, assignedTo: { select: { userId: true } } },
  });
  if (!task) throw new ForbiddenError("Task not found in this organization.");

  const isAssignee = task.assignedTo?.userId === ctx.userId;
  if (!canUpdateTask(ctx.role, isAssignee)) {
    throw new ForbiddenError("You do not have permission to change this task.");
  }

  return ctx;
}

function payloadFrom(formData: FormData) {
  return {
    clientId: formData.get("clientId") ?? "",
    taskName: formData.get("taskName") ?? "",
    serviceArea: formData.get("serviceArea") ?? "",
    description: formData.get("description") ?? "",
    period: formData.get("period") ?? "",
    assignedToId: formData.get("assignedToId") ?? "",
    reviewerId: formData.get("reviewerId") ?? "",
    priority: formData.get("priority") ?? "MEDIUM",
    dueDate: formData.get("dueDate") ?? "",
    startDate: formData.get("startDate") ?? "",
    reviewStatus: formData.get("reviewStatus") ?? "NOT_REVIEWED",
    clientDependency: formData.get("clientDependency") === "on",
    waitingFor: formData.get("waitingFor") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

export async function createTaskAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | null = null;

  try {
    const ctx = await requirePermission("task:create");

    const parsed = createTaskSchema.safeParse(payloadFrom(formData));
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    const created = await createTask(ctx, parsed.data);
    createdId = created.id;

    revalidatePath("/tasks");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/dashboard");
  } catch (error) {
    return toFormState(error);
  }

  redirect(`/tasks/${createdId}`);
}

export async function updateTaskAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const taskId = String(formData.get("taskId") ?? "");
    const ctx = await requireTaskPermission(taskId);

    const parsed = updateTaskSchema.safeParse({
      taskId,
      ...payloadFrom(formData),
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateTaskDetails(ctx, parsed.data);

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${taskId}`);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/dashboard");
    return { status: "success", message: "Task updated." };
  } catch (error) {
    return toFormState(error);
  }
}

/**
 * Refusal message carried back to the page it came from.
 *
 * These actions are plain `<form action>` submissions from a Server
 * Component, so they cannot return a FormState. Throwing would hand the user
 * Next's generic error boundary — and in production the real reason is
 * redacted, which is the one thing they need. The UI only offers legal moves,
 * but a refusal is still reachable: two people working from stale views, or a
 * permission revoked between render and submit. Legacy surfaced the same
 * condition as an explanatory toast, so the message is preserved and shown.
 */
function backWithError(pathname: string, message: string): never {
  // typedRoutes cannot verify a URL assembled at runtime; the pathname is
  // built from a validated uuid, not from user input.
  redirect(
    `${pathname}?error=${encodeURIComponent(message.slice(0, 200))}` as Route,
  );
}

function refusalMessage(error: unknown): string | null {
  if (error instanceof ForbiddenError || error instanceof TaskOperationError) {
    return error.message;
  }
  return null;
}

export async function changeTaskStatusAction(
  formData: FormData,
): Promise<void> {
  const parsed = changeTaskStatusSchema.safeParse({
    taskId: formData.get("taskId"),
    status: formData.get("status"),
  });
  if (!parsed.success) throw new Error("Invalid request.");

  const { taskId, status } = parsed.data;

  try {
    const ctx = await requireTaskPermission(taskId);
    await updateTaskStatus(ctx, taskId, status);
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/tasks/${taskId}`, message);
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/dashboard");
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const taskId = String(formData.get("taskId") ?? "");

  try {
    const ctx = await requirePermission("task:delete");
    await deleteTask(ctx, taskId);
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/tasks/${taskId}`, message);
  }

  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  redirect("/tasks");
}

export async function addTaskCommentAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const parsed = taskCommentSchema.safeParse({
      taskId: formData.get("taskId"),
      body: formData.get("body"),
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    // Commenting needs read access, not edit rights — discussion should not
    // require permission to change the work.
    const ctx = await requireOrgContext();
    await addTaskComment(ctx, parsed.data.taskId, parsed.data.body);

    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { status: "success" };
  } catch (error) {
    return toFormState(error);
  }
}

export async function deleteTaskCommentAction(
  formData: FormData,
): Promise<void> {
  const parsed = deleteTaskCommentSchema.safeParse({
    taskId: formData.get("taskId"),
    commentId: formData.get("commentId"),
  });
  if (!parsed.success) throw new Error("Invalid request.");

  const { taskId, commentId } = parsed.data;

  try {
    const ctx = await requireOrgContext();
    await deleteTaskComment(ctx, taskId, commentId);
  } catch (error) {
    const message = refusalMessage(error);
    if (message === null) throw error;
    backWithError(`/tasks/${taskId}`, message);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export interface BulkFormState extends FormState {
  updated?: number;
  skipped?: number;
  errors?: string[];
}

export async function bulkStatusAction(
  _prevState: BulkFormState,
  formData: FormData,
): Promise<BulkFormState> {
  try {
    const ctx = await requirePermission("task:update");

    const parsed = bulkStatusSchema.safeParse({
      taskIds: formData.getAll("taskIds").map(String),
      status: formData.get("status"),
    });
    if (!parsed.success) {
      return { status: "error", message: "Select tasks and a status first." };
    }

    const result = await bulkUpdateStatus(
      ctx,
      parsed.data.taskIds,
      parsed.data.status,
    );

    revalidatePath("/tasks");
    revalidatePath("/dashboard");

    return {
      status: result.errors.length > 0 ? "error" : "success",
      message:
        result.errors.length > 0
          ? `Updated ${result.updated}, skipped ${result.skipped}.`
          : `Updated ${result.updated} task(s).`,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
    };
  } catch (error) {
    return toFormState(error);
  }
}

export async function bulkReassignAction(
  _prevState: BulkFormState,
  formData: FormData,
): Promise<BulkFormState> {
  try {
    const ctx = await requirePermission("task:update");

    const parsed = bulkReassignSchema.safeParse({
      taskIds: formData.getAll("taskIds").map(String),
      assignedToId: formData.get("assignedToId") ?? "",
    });
    if (!parsed.success) {
      return { status: "error", message: "Select tasks first." };
    }

    const result = await bulkReassign(
      ctx,
      parsed.data.taskIds,
      parsed.data.assignedToId,
    );

    revalidatePath("/tasks");

    return {
      status: "success",
      message: `Reassigned ${result.updated} task(s).`,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
    };
  } catch (error) {
    return toFormState(error);
  }
}
