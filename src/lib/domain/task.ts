/**
 * Task rules.
 *
 * Port of legacy `apps-script/tasks/TaskLogic.gs` (audit §6.3). Day-math
 * lives in `date.ts`, which this deliberately does not duplicate — the legacy
 * split is preserved so there is exactly one definition of "overdue".
 */

import { TASK_CLOSED_STATUSES, TaskStatus } from "@/lib/domain/enums";

/**
 * Allowed transitions FROM each status. Same-status is always an allowed
 * no-op (see `nextStatusAllowed`).
 *
 * Three consequences are intentional and must survive:
 *  - `NOT_STARTED → COMPLETED` is forbidden; work passes through In Progress.
 *  - `WAITING_CLIENT → COMPLETED` is forbidden; it must return to In Progress
 *    first, so "waiting on the client" cannot silently become "done".
 *  - `CANCELLED` is terminal. A cancelled task is never resumed — create a
 *    new one, so the audit trail shows a new commitment rather than a
 *    resurrected one.
 */
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> =
  {
    [TaskStatus.NOT_STARTED]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
    [TaskStatus.IN_PROGRESS]: [
      TaskStatus.WAITING_CLIENT,
      TaskStatus.BLOCKED,
      TaskStatus.IN_REVIEW,
      TaskStatus.COMPLETED,
      TaskStatus.CANCELLED,
    ],
    [TaskStatus.WAITING_CLIENT]: [
      TaskStatus.IN_PROGRESS,
      TaskStatus.BLOCKED,
      TaskStatus.CANCELLED,
    ],
    [TaskStatus.BLOCKED]: [
      TaskStatus.IN_PROGRESS,
      TaskStatus.WAITING_CLIENT,
      TaskStatus.CANCELLED,
    ],
    [TaskStatus.IN_REVIEW]: [
      TaskStatus.IN_PROGRESS,
      TaskStatus.COMPLETED,
      TaskStatus.CANCELLED,
    ],
    // Reopening for a correction is allowed; nothing else is.
    [TaskStatus.COMPLETED]: [TaskStatus.IN_PROGRESS],
    [TaskStatus.CANCELLED]: [],
  };

export function isTaskOpen(status: TaskStatus): boolean {
  return !TASK_CLOSED_STATUSES.includes(status);
}

/** Whether `current → target` is allowed. Same-status is always permitted. */
export function nextStatusAllowed(
  current: TaskStatus,
  target: TaskStatus,
): boolean {
  if (current === target) return true;
  return TASK_STATUS_TRANSITIONS[current].includes(target);
}

export interface TaskValidationInput {
  clientId?: string | null;
  taskName?: string | null;
  serviceArea?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Legacy `validateTaskFields` — the minimum required to create a task.
 *
 * Does not check that the client or assignee exists; that is the caller's
 * job, since it needs the database. Priority and status are typed here, so
 * legacy's string-membership checks for them are enforced by the compiler
 * and by Zod at the edge rather than repeated at runtime.
 */
export function validateTaskFields(task: TaskValidationInput): ValidationResult {
  const errors: string[] = [];
  if (!task.clientId) errors.push("Client ID is required.");
  if (!task.taskName) errors.push("Task Name is required.");
  if (!task.serviceArea) errors.push("Service Area is required.");
  return { valid: errors.length === 0, errors };
}
