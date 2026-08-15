/**
 * Completion rules.
 *
 * Port of legacy `apps-script/tasks/ProgressLogic.gs` (audit §6.2).
 *
 * Both metrics use the SAME population — every task for the client except
 * Cancelled — so they are always directly comparable. That shared denominator
 * is the point: simple and weighted differ only in how each task is counted,
 * never in which tasks count.
 */

import {
  DEFAULT_PRIORITY_WEIGHT,
  PRIORITY_WEIGHTS,
  TaskStatus,
} from "@/lib/domain/enums";
import { isTaskOpen } from "@/lib/domain/task";
import type { DomainTask } from "@/lib/domain/types";

export interface SimpleCompletion {
  completed: number;
  total: number;
  /** Fraction 0..1; zero when there is nothing to complete. */
  pct: number;
}

export interface WeightedCompletion {
  completedWeight: number;
  totalWeight: number;
  pct: number;
}

type CountableTask = Pick<DomainTask, "status" | "priority">;

function countable<T extends { status: TaskStatus }>(tasks: readonly T[]): T[] {
  return tasks.filter((task) => task.status !== TaskStatus.CANCELLED);
}

/** Legacy `computeSimpleCompletion` — completed over non-cancelled, unweighted. */
export function computeSimpleCompletion(
  tasks: readonly CountableTask[],
): SimpleCompletion {
  const counted = countable(tasks);
  const completed = counted.filter(
    (task) => task.status === TaskStatus.COMPLETED,
  ).length;
  const total = counted.length;

  return { completed, total, pct: total === 0 ? 0 : completed / total };
}

/**
 * Legacy `computeWeightedCompletion` — each task counts by its priority
 * weight (Critical 4, High 3, Medium 2, Low 1) instead of 1, so finishing
 * critical work moves the number more than finishing trivia.
 *
 * An unrecognised or missing priority weighs 1, matching legacy's
 * `(weights && weights[priority]) || 1`.
 */
export function computeWeightedCompletion(
  tasks: readonly CountableTask[],
): WeightedCompletion {
  const counted = countable(tasks);

  let totalWeight = 0;
  let completedWeight = 0;

  for (const task of counted) {
    const weight = PRIORITY_WEIGHTS[task.priority] ?? DEFAULT_PRIORITY_WEIGHT;
    totalWeight += weight;
    if (task.status === TaskStatus.COMPLETED) completedWeight += weight;
  }

  return {
    completedWeight,
    totalWeight,
    pct: totalWeight === 0 ? 0 : completedWeight / totalWeight,
  };
}

/**
 * Legacy `computeNextDeadline` — the earliest due date among a client's still
 * OPEN tasks. Null when none qualify.
 *
 * Closed tasks are excluded: a completed deliverable's date is history, not a
 * deadline.
 */
export function computeNextDeadline(
  tasks: readonly Pick<DomainTask, "status" | "dueDate">[],
): Date | null {
  const candidates = tasks.filter(
    (task) => isTaskOpen(task.status) && task.dueDate !== null,
  );

  let earliest: Date | null = null;
  for (const task of candidates) {
    const due = task.dueDate as Date;
    if (earliest === null || due < earliest) earliest = due;
  }

  return earliest;
}
