import type { Permission } from "@/server/auth/permissions";

/**
 * Where each Control Center KPI drills down to.
 *
 * The Control Center answers "what is the state of the practice"; the obvious
 * next question is "which ones". Every count therefore links to the list that
 * contains exactly those records.
 *
 * **The query on each link must reproduce the KPI's own rule**, or the number
 * and the page behind it would disagree — the one failure a dashboard cannot
 * afford. `tests/unit/kpi-links.test.ts` pins each target against the same
 * validation schema the destination page parses, and Phase 7's live
 * verification checks every destination's row count against its KPI.
 *
 * This adds no business rule: the KPI values still come from the ported
 * `buildControlCenterKpis`, and the destination pages still apply their own
 * filters. It is navigation between screens that already exist.
 */

export interface KpiLink {
  pathname: "/clients" | "/tasks" | "/issues";
  query: Record<string, string>;
  /** Hidden when the viewer cannot open the destination. */
  permission: Permission;
}

/**
 * Notes on the ones that are not one-to-one:
 *
 * - `totalClients` counts every non-deleted client regardless of contract
 *   status, so it links to `status=ALL` — not the list's default view.
 * - `openTasks` uses `isTaskOpen`, which already excludes Completed and
 *   Cancelled; the list's `OPEN` pseudo-status is the same set.
 * - `overdueTasks` needs `status=ALL` alongside `overdue=true`, because the
 *   overdue filter supplies its own status constraint and the list would
 *   otherwise default to OPEN and narrow it twice (same set, but the query
 *   should say what it means).
 * - `issuesNeedingAttention` likewise pairs `surfaced=true` with `status=ALL`.
 * - `overallCompletionPct` has no list — it is an average, not a set.
 */
export const KPI_LINKS: Record<string, KpiLink> = {
  totalClients: {
    pathname: "/clients",
    query: { status: "ALL" },
    permission: "client:view",
  },
  activeClients: {
    pathname: "/clients",
    query: { status: "ACTIVE" },
    permission: "client:view",
  },
  onboardingClients: {
    pathname: "/clients",
    query: { status: "ONBOARDING" },
    permission: "client:view",
  },
  onHoldClients: {
    pathname: "/clients",
    query: { status: "ON_HOLD" },
    permission: "client:view",
  },
  clientsAtRisk: {
    pathname: "/clients",
    query: { status: "ALL", health: "AT_RISK" },
    permission: "client:view",
  },
  clientsDelayed: {
    pathname: "/clients",
    query: { status: "ALL", health: "DELAYED" },
    permission: "client:view",
  },
  openTasks: {
    pathname: "/tasks",
    query: { status: "OPEN" },
    permission: "task:view",
  },
  overdueTasks: {
    pathname: "/tasks",
    query: { status: "ALL", overdue: "true" },
    permission: "task:view",
  },
  tasksCompleted: {
    pathname: "/tasks",
    query: { status: "COMPLETED" },
    permission: "task:view",
  },
  waitingOnClient: {
    pathname: "/tasks",
    query: { status: "WAITING_CLIENT" },
    permission: "task:view",
  },
  blockedTasks: {
    pathname: "/tasks",
    query: { status: "BLOCKED" },
    permission: "task:view",
  },
  openIssues: {
    pathname: "/issues",
    query: { status: "OPEN" },
    permission: "issue:view",
  },
  issuesNeedingAttention: {
    pathname: "/issues",
    query: { status: "ALL", surfaced: "true" },
    permission: "issue:view",
  },
};
