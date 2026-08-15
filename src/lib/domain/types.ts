/**
 * Domain record shapes.
 *
 * These are the inputs the pure business rules operate on. They are
 * deliberately NOT Prisma models: the domain layer must stay free of Prisma,
 * Next.js, Auth.js, and React so the rules remain deterministic and testable
 * outside a request (master prompt §36, Phase 3 requirements).
 *
 * Services query Prisma and map rows into these shapes; the rules never see a
 * database client.
 *
 * Representation differences from the legacy spreadsheet rows, and only
 * these:
 *
 * | Legacy                       | Domain              |
 * |------------------------------|---------------------|
 * | `'Completed'` (string)       | `TaskStatus.COMPLETED` |
 * | `''` for an absent date      | `null`              |
 * | `''` returned for "no value" | `null`              |
 * | `t['Due Date']`              | `task.dueDate`      |
 *
 * Every one is a representation change. No rule, threshold, ordering, or
 * boundary differs — that is what the parity suite in tests/parity proves,
 * by running the legacy Apps Script functions and these ports over the same
 * fixtures and comparing outputs.
 */

import type {
  ClientHealth,
  CloseStageStatus,
  ContractStatus,
  Frequency,
  IssueSeverity,
  IssueStatus,
  Priority,
  RequestStatus,
  ReviewStatus,
  TaskStatus,
} from "@/lib/domain/enums";

/** "YYYY-MM" — legacy period format, load-bearing for generation and dedupe. */
export type Period = string;

export interface DomainClient {
  id: string;
  displayId: string;
  name: string;
  companyName: string | null;
  industry: string | null;
  businessType: string | null;
  servicePackageName: string | null;
  accountManagerName: string | null;
  backupMemberName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  contractStatus: ContractStatus;
  priority: Priority;
  health: ClientHealth;
  /** Fractions in 0..1, matching legacy. */
  simpleCompletionPct: number;
  weightedCompletionPct: number;
  lastActivityAt: Date | null;
  nextDeadline: Date | null;
  notes: string | null;
}

export interface DomainTask {
  id: string;
  displayId: string;
  clientId: string;
  clientName: string;
  serviceArea: string;
  taskName: string;
  period: Period | null;
  frequency: Frequency | null;
  assignedToName: string | null;
  priority: Priority;
  status: TaskStatus;
  dueDate: Date | null;
  completionDate: Date | null;
  completionPct: number;
  reviewStatus: ReviewStatus;
}

export interface DomainIssue {
  id: string;
  displayId: string;
  clientId: string;
  clientName: string;
  title: string;
  category: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  assignedToName: string | null;
  dateRaised: Date | null;
  deadline: Date | null;
  requiredAction: string | null;
}

export interface DomainRequest {
  id: string;
  displayId: string;
  clientId: string;
  clientName: string;
  title: string;
  status: RequestStatus;
  priority: Priority;
  requestedDate: Date | null;
  requiredBy: Date | null;
  receivedDate: Date | null;
  assignedToName: string | null;
}

export interface DomainMember {
  id: string;
  name: string;
  jobTitle: string | null;
  /** Legacy EMPLOYEES."Active?" — gates assignability. */
  isActive: boolean;
  /** Null means "never judged overloaded"; zero is a real capacity. */
  capacity: number | null;
}

export interface DomainTaskTemplate {
  id: string;
  servicePackageName: string;
  serviceArea: string;
  taskName: string;
  description: string | null;
  frequency: Frequency;
  priority: Priority;
  /** A ROLE (job title), resolved to a person per client at generation time. */
  defaultAssigneeRole: string | null;
  typicalDurationDays: number;
  requiresClientInput: boolean;
  isActive: boolean;
}

export interface DomainCloseStage {
  stageName: string;
  stageOrder: number;
  /**
   * Null represents a legacy blank cell — see `monthly-close.ts`, where it
   * changes the completion denominator exactly as COUNTA did.
   */
  status: CloseStageStatus | null;
}

/** Health thresholds, sourced per organization from settings. */
export interface HealthThresholds {
  delayedTotalOverdueCount: number;
  atRiskOverdueCount: number;
  atRiskDueSoonDays: number;
}

/** Inputs to the health rule set — gathered by the engine, never by the rule. */
export interface HealthStats {
  contractStatus: ContractStatus;
  overdueCount: number;
  criticalOverdueCount: number;
  openCriticalIssueCount: number;
  openHighIssueCount: number;
  /** Days until the next open Critical/High deadline; null when there is none. */
  daysToNextImportantDeadline: number | null;
}
