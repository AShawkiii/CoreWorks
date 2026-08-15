import { z } from "zod";

import {
  Priority,
  ReviewStatus,
  TaskCategory,
  TaskStatus,
} from "@/generated/prisma/enums";
import { optionalDateSchema } from "@/lib/validation/client";

/**
 * Task validation (master prompt §12/§37).
 *
 * Legacy `validateTaskFields` requires Client ID, Task Name, and Service Area
 * (audit §6.3); those are enforced here at the edge and again in the ported
 * domain function. Status transitions are NOT validated here — the state
 * machine is a domain rule, checked by the service against the task's current
 * status, which a form cannot know.
 */

const optionalText = (max: number, label: string) =>
  z
    .union([z.literal(""), z.string().trim().max(max, `${label} is too long.`)])
    .transform((value) => (value === "" ? null : value));

export const taskStatusSchema = z.enum(
  Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]],
);

export const taskPrioritySchema = z.enum(
  Object.values(Priority) as [Priority, ...Priority[]],
);

export const reviewStatusSchema = z.enum(
  Object.values(ReviewStatus) as [ReviewStatus, ...ReviewStatus[]],
);

export const taskCategorySchema = z.enum(
  Object.values(TaskCategory) as [TaskCategory, ...TaskCategory[]],
);

/** "YYYY-MM" — the legacy period format, load-bearing for generation dedupe. */
export const periodSchema = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM."),
  ])
  .transform((value) => (value === "" ? null : value));

const memberIdSchema = z
  .union([z.literal(""), z.string().uuid("Select a valid team member.")])
  .transform((value) => (value === "" ? null : value));

const baseTaskFields = {
  clientId: z.string().uuid("Select a client."),
  taskName: z
    .string()
    .trim()
    .min(2, "Task name must be at least 2 characters.")
    .max(200, "Task name is too long."),
  serviceArea: z
    .string()
    .trim()
    .min(1, "Service area is required.")
    .max(80, "Service area is too long."),
  description: optionalText(4000, "Description"),
  period: periodSchema,
  assignedToId: memberIdSchema,
  reviewerId: memberIdSchema,
  priority: taskPrioritySchema,
  dueDate: optionalDateSchema,
  startDate: optionalDateSchema,
  reviewStatus: reviewStatusSchema,
  clientDependency: z.boolean().optional().default(false),
  waitingFor: optionalText(200, "Waiting for"),
  notes: optionalText(4000, "Notes"),
};

export const createTaskSchema = z.object({
  ...baseTaskFields,
  taskCategory: taskCategorySchema.optional().default(TaskCategory.AD_HOC),
});

export const updateTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  ...baseTaskFields,
});

/**
 * A status change is its own action, separate from editing fields.
 *
 * Legacy treated a status edit as a distinct event with side effects —
 * completion stamping, activity logging, progress and health recalculation —
 * so it is not folded into a general field update.
 */
export const changeTaskStatusSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  status: taskStatusSchema,
});

export const reassignTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  assignedToId: memberIdSchema,
});

export const taskCommentSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(4000, "Comment is too long."),
});

export const deleteTaskCommentSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  commentId: z.string().uuid("Invalid comment."),
});

/** Bulk operations (master prompt §12) — a list of ids plus one change. */
export const bulkTaskIdsSchema = z
  .array(z.string().uuid())
  .min(1, "Select at least one task.")
  .max(200, "Select at most 200 tasks at a time.");

export const bulkStatusSchema = z.object({
  taskIds: bulkTaskIdsSchema,
  status: taskStatusSchema,
});

export const bulkReassignSchema = z.object({
  taskIds: bulkTaskIdsSchema,
  assignedToId: memberIdSchema,
});

/** Task list query — filters, search, sort, pagination. */
export const taskListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  clientId: z.union([z.literal("ALL"), z.string().uuid()]).optional(),
  status: z.union([z.literal("ALL"), z.literal("OPEN"), taskStatusSchema]).optional(),
  priority: z.union([z.literal("ALL"), taskPrioritySchema]).optional(),
  assignedToId: z
    .union([z.literal("ALL"), z.literal("UNASSIGNED"), z.string().uuid()])
    .optional(),
  period: z.union([z.literal("ALL"), z.string().trim().max(7)]).optional(),
  /**
   * Overdue is a derived condition, not a stored column — see the service.
   *
   * Parsed by explicit token rather than `z.coerce.boolean()`, which treats any
   * non-empty string as true and would read `?overdue=false` as ON.
   */
  overdue: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true" || value === "1",
    ),
  sort: z
    .enum(["dueDate", "priority", "client", "status", "created"])
    .optional()
    .default("dueDate"),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskCommentInput = z.infer<typeof taskCommentSchema>;
