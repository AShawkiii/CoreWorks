import { describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  DEFAULT_SETTINGS,
} from "@/lib/domain/enums";
import { computeClientHealth, healthSortRank } from "@/lib/domain/health";
import type { HealthStats, HealthThresholds } from "@/lib/domain/types";

import { CONTRACT_TO_LEGACY, HEALTH_TO_LEGACY } from "./fixtures";
import { legacyFn, LEGACY_MODULES, loadLegacyContext } from "./legacy-context";

/**
 * Differential parity for clients/HealthLogic.gs (audit §6.1) — the rule that
 * decides what management looks at first.
 *
 * Exhaustive over the cross-product of every input that can change the
 * outcome, rather than a hand-picked set, so no branch or boundary is missed.
 */
const ctx = loadLegacyContext([...LEGACY_MODULES.healthLogic]);

const legacyHealth = legacyFn<
  (stats: Record<string, unknown>, thresholds: HealthThresholds) => string
>(ctx, "computeClientHealth");

const THRESHOLDS: HealthThresholds = {
  delayedTotalOverdueCount: DEFAULT_SETTINGS.HEALTH_DELAYED_TOTAL_OVERDUE_COUNT,
  atRiskOverdueCount: DEFAULT_SETTINGS.HEALTH_AT_RISK_OVERDUE_COUNT,
  atRiskDueSoonDays: DEFAULT_SETTINGS.HEALTH_AT_RISK_DUE_SOON_DAYS,
};

function toLegacyStats(stats: HealthStats): Record<string, unknown> {
  return {
    contractStatus: CONTRACT_TO_LEGACY[stats.contractStatus],
    overdueCount: stats.overdueCount,
    criticalOverdueCount: stats.criticalOverdueCount,
    openCriticalIssueCount: stats.openCriticalIssueCount,
    openHighIssueCount: stats.openHighIssueCount,
    daysToNextImportantDeadline: stats.daysToNextImportantDeadline,
  };
}

describe("parity: computeClientHealth (exhaustive)", () => {
  const contractStatuses = Object.values(ContractStatus);
  // 0, 1, 2 straddle the At Risk threshold; 3 and 5 straddle Delayed.
  const overdueCounts = [0, 1, 2, 3, 5];
  const criticalOverdueCounts = [0, 1];
  const criticalIssueCounts = [0, 1];
  const highIssueCounts = [0, 1];
  const deadlines: (number | null)[] = [null, -1, 0, 2, 3, 4];

  let checked = 0;

  for (const contractStatus of contractStatuses) {
    for (const overdueCount of overdueCounts) {
      for (const criticalOverdueCount of criticalOverdueCounts) {
        // A critical overdue task implies at least that many overdue tasks.
        if (criticalOverdueCount > overdueCount) continue;

        for (const openCriticalIssueCount of criticalIssueCounts) {
          for (const openHighIssueCount of highIssueCounts) {
            for (const daysToNextImportantDeadline of deadlines) {
              checked += 1;

              const stats: HealthStats = {
                contractStatus,
                overdueCount,
                criticalOverdueCount,
                openCriticalIssueCount,
                openHighIssueCount,
                daysToNextImportantDeadline,
              };

              it(`${contractStatus} od=${overdueCount} cod=${criticalOverdueCount} ci=${openCriticalIssueCount} hi=${openHighIssueCount} dl=${daysToNextImportantDeadline}`, () => {
                const mine = computeClientHealth(stats, THRESHOLDS);
                const theirs = legacyHealth(toLegacyStats(stats), THRESHOLDS);
                expect(HEALTH_TO_LEGACY[mine]).toBe(theirs);
              });
            }
          }
        }
      }
    }
  }

  it("covered the full cross-product", () => {
    expect(checked).toBeGreaterThan(500);
  });
});

describe("parity: health thresholds are honoured, not hardcoded", () => {
  const strict: HealthThresholds = {
    delayedTotalOverdueCount: 10,
    atRiskOverdueCount: 5,
    atRiskDueSoonDays: 1,
  };

  const cases: HealthStats[] = [
    {
      contractStatus: ContractStatus.ACTIVE,
      overdueCount: 1,
      criticalOverdueCount: 0,
      openCriticalIssueCount: 0,
      openHighIssueCount: 0,
      daysToNextImportantDeadline: null,
    },
    {
      contractStatus: ContractStatus.ACTIVE,
      overdueCount: 6,
      criticalOverdueCount: 0,
      openCriticalIssueCount: 0,
      openHighIssueCount: 0,
      daysToNextImportantDeadline: null,
    },
    {
      contractStatus: ContractStatus.ACTIVE,
      overdueCount: 0,
      criticalOverdueCount: 0,
      openCriticalIssueCount: 0,
      openHighIssueCount: 0,
      daysToNextImportantDeadline: 2,
    },
  ];

  it.each(cases)("stricter thresholds change the outcome identically", (stats) => {
    const mine = computeClientHealth(stats, strict);
    const theirs = legacyHealth(toLegacyStats(stats), strict);
    expect(HEALTH_TO_LEGACY[mine]).toBe(theirs);
  });
});

describe("Delayed threshold is 3, per the code and not the legacy docs", () => {
  const base: HealthStats = {
    contractStatus: ContractStatus.ACTIVE,
    overdueCount: 0,
    criticalOverdueCount: 0,
    openCriticalIssueCount: 0,
    openHighIssueCount: 0,
    daysToNextImportantDeadline: null,
  };

  it("1 and 2 overdue are At Risk; 3 is Delayed", () => {
    // Audit defect D2: legacy architecture.md §7 claimed 1, which would have
    // made the At Risk branch unreachable. HealthLogic.gs uses 3.
    expect(computeClientHealth({ ...base, overdueCount: 1 }, THRESHOLDS)).toBe(
      ClientHealth.AT_RISK,
    );
    expect(computeClientHealth({ ...base, overdueCount: 2 }, THRESHOLDS)).toBe(
      ClientHealth.AT_RISK,
    );
    expect(computeClientHealth({ ...base, overdueCount: 3 }, THRESHOLDS)).toBe(
      ClientHealth.DELAYED,
    );
  });
});

describe("parity: healthSortRank", () => {
  // healthSortRank lives in ControlCenterViewModelLogic.gs, which needs the
  // whole dependency chain loaded alongside it.
  const ctxSort = loadLegacyContext([...LEGACY_MODULES.controlCenter]);

  const legacyRank = legacyFn<(health: string) => number>(
    ctxSort,
    "healthSortRank",
  );

  it.each(Object.values(ClientHealth))("rank(%s)", (health) => {
    expect(healthSortRank(health)).toBe(legacyRank(HEALTH_TO_LEGACY[health]));
  });

  it("ranks Delayed 0 without the falsy-zero trap", () => {
    // Legacy used hasOwnProperty for exactly this reason; `|| 99` would
    // demote the most urgent clients to unranked.
    expect(healthSortRank(ClientHealth.DELAYED)).toBe(0);
    expect(legacyRank("Delayed")).toBe(0);
  });

  it("sorts an unknown health last, identically to legacy", () => {
    expect(healthSortRank("Something Else")).toBe(legacyRank("Something Else"));
  });
});
