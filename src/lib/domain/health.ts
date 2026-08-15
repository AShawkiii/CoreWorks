/**
 * Client health.
 *
 * Port of legacy `apps-script/clients/HealthLogic.gs` (audit §6.1) — the
 * single most important rule in the product, since it drives what management
 * looks at first.
 *
 * The four branches are evaluated strictly in order; the first match wins.
 * That ordering is itself a rule: On Hold is checked before anything else so
 * a paused client never shows as Delayed for work nobody is doing.
 */

import {
  CLIENT_HEALTH_SORT_RANK,
  ClientHealth,
  ContractStatus,
  UNRANKED_HEALTH_RANK,
} from "@/lib/domain/enums";
import type { HealthStats, HealthThresholds } from "@/lib/domain/types";

/**
 * Legacy `computeClientHealth`.
 *
 * 1. Contract Status = On Hold                        → On Hold  (hard override)
 * 2. any Critical overdue task,
 *    OR overdue count >= delayedTotalOverdueCount (3),
 *    OR any open Critical issue                        → Delayed
 * 3. overdue count >= atRiskOverdueCount (1),
 *    OR an important deadline due within N days,
 *    OR any open High issue                            → At Risk
 * 4. otherwise                                         → On Track
 *
 * The Delayed threshold is 3, not 1. Legacy `architecture.md` §7 said 1,
 * which would have made branch 3 unreachable; the code is authoritative
 * (audit defect D2).
 *
 * `daysToNextImportantDeadline` is scoped by the caller to Critical/High
 * priority open tasks only. That scoping is the rule, not an optimisation:
 * counting every priority would mark any client with routine weekly work
 * permanently At Risk, which destroys the signal.
 */
export function computeClientHealth(
  stats: HealthStats,
  thresholds: HealthThresholds,
): ClientHealth {
  if (stats.contractStatus === ContractStatus.ON_HOLD) {
    return ClientHealth.ON_HOLD;
  }

  if (
    stats.criticalOverdueCount > 0 ||
    stats.overdueCount >= thresholds.delayedTotalOverdueCount ||
    stats.openCriticalIssueCount > 0
  ) {
    return ClientHealth.DELAYED;
  }

  const importantDeadlineDueSoon =
    stats.daysToNextImportantDeadline !== null &&
    stats.daysToNextImportantDeadline >= 0 &&
    stats.daysToNextImportantDeadline <= thresholds.atRiskDueSoonDays;

  if (
    stats.overdueCount >= thresholds.atRiskOverdueCount ||
    importantDeadlineDueSoon ||
    stats.openHighIssueCount > 0
  ) {
    return ClientHealth.AT_RISK;
  }

  return ClientHealth.ON_TRACK;
}

/**
 * Legacy `healthSortRank` — most urgent first: Delayed 0, At Risk 1,
 * On Track 2, On Hold 3. Unknown sorts last.
 *
 * Legacy used `hasOwnProperty` rather than `rank[health] || 99`, because
 * Delayed legitimately ranks 0 and 0 is falsy — the `||` idiom would have
 * silently demoted the most urgent clients to unranked and defeated the whole
 * sort. The same trap exists in TypeScript with `||`; this uses a nullish
 * check so a rank of 0 survives.
 */
export function healthSortRank(health: ClientHealth | string): number {
  const rank = (CLIENT_HEALTH_SORT_RANK as Record<string, number | undefined>)[
    health
  ];
  return rank ?? UNRANKED_HEALTH_RANK;
}

/**
 * Legacy sort used by the Control Center and Clients list: most urgent
 * health first, then client name alphabetically.
 */
export function compareByHealthThenName(
  a: { health: ClientHealth; clientName: string },
  b: { health: ClientHealth; clientName: string },
): number {
  const rankDiff = healthSortRank(a.health) - healthSortRank(b.health);
  if (rankDiff !== 0) return rankDiff;
  return String(a.clientName).localeCompare(String(b.clientName));
}
