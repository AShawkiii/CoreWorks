/**
 * Monthly close rules.
 *
 * Port of the live formulas in legacy
 * `apps-script/tasks/MonthlyCloseSheetBuilder.gs::writeMonthlyCloseFormulas`
 * (audit §6.13). Legacy expressed these as spreadsheet formulas rather than
 * as a `*Logic.gs` module, so this is the one rule set with no legacy
 * JavaScript counterpart to diff against — the parity tests assert against
 * the formula semantics instead, case by case.
 *
 * The formulas, verbatim:
 *
 *   Completion % = IF(COUNTA(stages)=0, 0,
 *                     COUNTIF(stages,"Completed") / COUNTA(stages))
 *
 *   Close Status = IFS(completion = 1,               "Closed",
 *                      COUNTIF(stages,"Blocked") > 0,"Blocked",
 *                      completion > 0,               "In Progress",
 *                      TRUE,                         "Not Started")
 */

import { CloseStageStatus, CloseStatus } from "@/lib/domain/enums";
import type { DomainCloseStage } from "@/lib/domain/types";

/**
 * COUNTA semantics: a blank stage is not counted at all, in either the
 * numerator or the denominator.
 *
 * This is faithful to legacy and has a consequence worth knowing: on a close
 * where staff have touched only one stage and marked it Completed, legacy
 * reports 100% and "Closed" — one of one non-blank stage. CoreWorks
 * materialises all 18 stages with an explicit status when a close is created,
 * so the denominator is always 18 and that situation cannot arise. The
 * function still honours blanks so imported legacy data behaves as it did in
 * the sheet (see docs/phase3-business-logic.md, difference DIFF-1).
 */
function nonBlank(
  stages: readonly DomainCloseStage[],
): DomainCloseStage[] {
  return stages.filter((stage) => stage.status !== null);
}

/** Legacy MONTHLY_CLOSE."Completion %" — fraction 0..1. */
export function computeCloseCompletion(
  stages: readonly DomainCloseStage[],
): number {
  const counted = nonBlank(stages);
  if (counted.length === 0) return 0;

  const completed = counted.filter(
    (stage) => stage.status === CloseStageStatus.COMPLETED,
  ).length;

  return completed / counted.length;
}

/**
 * Legacy MONTHLY_CLOSE."Close Status".
 *
 * Order is load-bearing: fully complete is checked BEFORE blocked, so a close
 * whose stages are all Completed reads Closed. Blocked outranks In Progress,
 * so any blocked stage surfaces even when most of the close is done.
 */
export function computeCloseStatus(
  stages: readonly DomainCloseStage[],
): CloseStatus {
  const completion = computeCloseCompletion(stages);

  if (completion === 1) return CloseStatus.CLOSED;

  const anyBlocked = stages.some(
    (stage) => stage.status === CloseStageStatus.BLOCKED,
  );
  if (anyBlocked) return CloseStatus.BLOCKED;

  if (completion > 0) return CloseStatus.IN_PROGRESS;

  return CloseStatus.NOT_STARTED;
}

/**
 * Builds the 18 stage rows for a new close, in legacy column order.
 *
 * Ordering is preserved through `stageOrder` so the close view renders the
 * same left-to-right sequence the spreadsheet used — that sequence is the
 * firm's actual close checklist, not an arbitrary list.
 */
export function buildCloseStages(
  stageNames: readonly string[],
): DomainCloseStage[] {
  return stageNames.map((stageName, index) => ({
    stageName,
    stageOrder: index,
    status: CloseStageStatus.NOT_STARTED,
  }));
}
