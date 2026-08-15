/**
 * Template expansion.
 *
 * Port of legacy `apps-script/templates/TemplateExpansionLogic.gs`
 * (audit §6.11).
 *
 * This is the ONE place a template becomes a task. Legacy shared it between
 * onboarding and monthly generation deliberately, so the two paths can never
 * drift into producing different tasks from the same template.
 */

import {
  ReviewStatus,
  TaskCategory,
  TaskStatus,
  type Frequency,
  type Priority,
} from "@/lib/domain/enums";
import type { DomainTaskTemplate, Period } from "@/lib/domain/types";

/** The fields expansion decides. Ids, timestamps, and display ids are the caller's. */
export interface ExpandedTask {
  clientId: string;
  serviceArea: string;
  taskCategory: TaskCategory;
  taskName: string;
  description: string | null;
  period: Period;
  frequency: Frequency;
  assignedToName: string | null;
  priority: Priority;
  status: TaskStatus;
  dueDate: Date;
  clientDependency: boolean;
  completionPct: number;
  reviewStatus: ReviewStatus;
  taskTemplateId: string;
}

/**
 * Legacy `expandTemplateToTask`.
 *
 * A generated task always starts Not Started at 0%, Not Reviewed, and
 * inherits `clientDependency` from the template's "Required Client Input?" —
 * that flag is what later lets the Control Center answer "what are we
 * waiting on the client for?".
 */
export function expandTemplateToTask(
  template: DomainTaskTemplate,
  clientId: string,
  period: Period,
  dueDate: Date,
  assigneeName: string | null,
  taskCategory: TaskCategory,
): ExpandedTask {
  return {
    clientId,
    serviceArea: template.serviceArea,
    taskCategory,
    taskName: template.taskName,
    description: template.description,
    period,
    frequency: template.frequency,
    assignedToName: assigneeName,
    priority: template.priority,
    status: TaskStatus.NOT_STARTED,
    dueDate,
    clientDependency: template.requiresClientInput,
    completionPct: 0,
    reviewStatus: ReviewStatus.NOT_REVIEWED,
    taskTemplateId: template.id,
  };
}

/**
 * Legacy `taskDedupeKey` — `clientId|serviceArea|taskName|period`.
 *
 * This key is what makes generation safe to re-run and what preserves
 * history: a period that already has its tasks is skipped rather than
 * duplicated, and prior periods are never touched.
 *
 * Modelled as an index rather than a unique constraint (see database.md):
 * legacy consults it only inside the generators, while manual ad-hoc
 * creation may legitimately repeat a name within a period.
 */
export function taskDedupeKey(
  clientId: string,
  serviceArea: string,
  taskName: string,
  period: Period | null,
): string {
  return `${clientId}|${serviceArea}|${taskName}|${period ?? ""}`;
}
