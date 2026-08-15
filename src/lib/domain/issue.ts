/**
 * Issue rules.
 *
 * Port of legacy `apps-script/issues/IssueLogic.gs` (audit §6.5).
 *
 * `selectSurfacedIssues` is the single authority for "issues needing
 * attention". Legacy used the same function for both the spreadsheet Control
 * Center and the Web App, and the audit is explicit that it must not be
 * re-derived — a second, slightly different prioritisation would mean two
 * answers to the question management asks first.
 */

import {
  ISSUE_OPEN_STATUSES,
  IssueSeverity,
  PRIORITY_WEIGHTS,
  type IssueStatus,
} from "@/lib/domain/enums";
import { daysBetween } from "@/lib/domain/date";
import type { DomainIssue } from "@/lib/domain/types";

export function isIssueOpen(status: IssueStatus): boolean {
  return ISSUE_OPEN_STATUSES.includes(status);
}

/** Legacy `isUnresolvedCriticalOrHigh`. */
export function isUnresolvedCriticalOrHigh(
  issue: Pick<DomainIssue, "status" | "severity">,
): boolean {
  return (
    isIssueOpen(issue.status) &&
    (issue.severity === IssueSeverity.CRITICAL ||
      issue.severity === IssueSeverity.HIGH)
  );
}

/** Legacy `isOverdueIssue` — an open issue whose deadline has passed. */
export function isOverdueIssue(
  issue: Pick<DomainIssue, "status" | "deadline">,
  today: Date,
): boolean {
  if (!isIssueOpen(issue.status) || !issue.deadline) return false;
  return daysBetween(today, issue.deadline) > 0;
}

/**
 * Severity rank, reusing PRIORITY_WEIGHTS exactly as legacy did — severity
 * and priority share the Low/Medium/High/Critical scale, so they share the
 * weights. Unknown ranks 0.
 */
export function issueSeverityRank(severity: IssueSeverity | string): number {
  return (PRIORITY_WEIGHTS as Record<string, number | undefined>)[severity] ?? 0;
}

/**
 * Legacy `selectSurfacedIssues` — the Control Center's surfacing rule.
 *
 * Filter: unresolved AND (Critical or High severity, OR past its deadline).
 * Sort:   most severe first, then OLDEST first within a severity.
 *
 * The oldest-first tiebreak matters: among equally severe issues the one
 * that has been ignored longest rises, rather than the newest and most
 * visible one.
 */
export function selectSurfacedIssues<
  T extends Pick<DomainIssue, "status" | "severity" | "deadline" | "dateRaised">,
>(issues: readonly T[], today: Date): T[] {
  const surfaced = issues.filter(
    (issue) => isUnresolvedCriticalOrHigh(issue) || isOverdueIssue(issue, today),
  );

  return [...surfaced].sort((a, b) => {
    const severityDiff =
      issueSeverityRank(b.severity) - issueSeverityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;

    const aRaised = a.dateRaised ? a.dateRaised.getTime() : 0;
    const bRaised = b.dateRaised ? b.dateRaised.getTime() : 0;
    return aRaised - bRaised;
  });
}
