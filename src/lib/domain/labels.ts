/**
 * Human-readable labels for domain enums.
 *
 * These strings are exactly the legacy spreadsheet values (audit §5), so the
 * UI reads identically to the system it replaces and CSV import/export can
 * round-trip against legacy headers (migration-plan §3.2).
 */

import {
  ClientHealth,
  ContractStatus,
  IssueSeverity,
  IssueStatus,
  Priority,
  RequestStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import type {
  CloseStageStatus,
  CloseStatus,
  Frequency,
  OrgRole,
  ReviewStatus,
  TaskCategory,
} from "@/generated/prisma/enums";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  WAITING_CLIENT: "Waiting Client",
  BLOCKED: "Blocked",
  IN_REVIEW: "In Review",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const CLIENT_HEALTH_LABELS: Record<ClientHealth, string> = {
  ON_TRACK: "On Track",
  AT_RISK: "At Risk",
  DELAYED: "Delayed",
  ON_HOLD: "On Hold",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  REQUESTED: "Requested",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  NOT_AVAILABLE: "Not Available",
  CANCELLED: "Cancelled",
};

export const ISSUE_SEVERITY_LABELS: Record<IssueSeverity, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  NOT_REVIEWED: "Not Reviewed",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes Requested",
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually",
  ONE_TIME: "One-Time",
};

export const CLOSE_STAGE_STATUS_LABELS: Record<CloseStageStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
  WAITING_CLIENT: "Waiting Client",
};

export const CLOSE_STATUS_LABELS: Record<CloseStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  CLOSED: "Closed",
};

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  ONBOARDING: "Onboarding",
  RECURRING: "Recurring",
  AD_HOC: "Ad-Hoc",
};

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  ACCOUNTANT: "Accountant",
  TEAM_MEMBER: "Team Member",
  VIEWER: "Viewer",
};

/** Legacy `ENUMS.CLIENT_HEALTH.emoji` — retained for CSV export parity. */
export const CLIENT_HEALTH_EMOJI: Record<ClientHealth, string> = {
  ON_TRACK: "🟢",
  AT_RISK: "🟡",
  DELAYED: "🔴",
  ON_HOLD: "⚪",
};
