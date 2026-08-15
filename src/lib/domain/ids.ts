/**
 * Display-ID formats.
 *
 * Transcribed from legacy `utils/IdService.gs::ID_CONFIG` and
 * `utils/IdLogic.gs` (audit §4). These IDs are user-facing — staff cite
 * "TSK-004321" in email — so the FORMAT is preserved exactly.
 *
 * The generation MECHANISM is deliberately different (audit defect D3):
 * legacy scanned existing IDs for the highest suffix and added one, which is
 * safe single-threaded but races under a concurrent web backend. Allocation
 * now goes through an atomic counter (`IdSequence`); see
 * `src/server/services/ids.ts`.
 */

export const ID_ENTITIES = [
  "CLIENT",
  "MEMBER",
  "TASK",
  "TASK_TEMPLATE",
  "CLIENT_REQUEST",
  "ISSUE",
  "ACTIVITY",
  "SERVICE",
  "SERVICE_PACKAGE",
] as const;

export type IdEntity = (typeof ID_ENTITIES)[number];

export interface IdFormat {
  readonly prefix: string;
  readonly padWidth: number;
}

/** Legacy prefixes and pad widths, unchanged (audit §4). */
export const ID_FORMATS: Record<IdEntity, IdFormat> = {
  CLIENT: { prefix: "CL-", padWidth: 4 },
  MEMBER: { prefix: "EMP-", padWidth: 3 },
  TASK: { prefix: "TSK-", padWidth: 6 },
  TASK_TEMPLATE: { prefix: "TPL-", padWidth: 3 },
  CLIENT_REQUEST: { prefix: "REQ-", padWidth: 4 },
  ISSUE: { prefix: "ISS-", padWidth: 4 },
  ACTIVITY: { prefix: "ACT-", padWidth: 7 },
  SERVICE: { prefix: "SVC-", padWidth: 3 },
  SERVICE_PACKAGE: { prefix: "PKG-", padWidth: 3 },
};

/** Formats a numeric sequence value as a display ID, e.g. 7 -> "CL-0007". */
export function formatDisplayId(entity: IdEntity, value: number): string {
  const format = ID_FORMATS[entity];
  return format.prefix + String(value).padStart(format.padWidth, "0");
}

/**
 * Parses the numeric suffix out of a display ID, or null if it does not match
 * the expected `<prefix><digits>` shape.
 *
 * Legacy `nextSequentialId` ignored malformed IDs so a stray row could not
 * corrupt numbering; that tolerance is preserved here and used when seeding a
 * sequence from imported data (migration-plan §3.5).
 */
export function parseDisplayId(entity: IdEntity, id: string): number | null {
  const format = ID_FORMATS[entity];
  if (!id.startsWith(format.prefix)) return null;

  const suffix = id.slice(format.prefix.length);
  if (!/^\d+$/.test(suffix)) return null;

  const parsed = Number.parseInt(suffix, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Composite monthly-close ID — legacy `buildMonthlyCloseId()`:
 * `MC-<ClientDisplayId>-<YYYYMM>`, e.g. "MC-CL-0007-202608".
 * Not sequential, so it does not use IdSequence.
 */
export function buildMonthlyCloseId(
  clientDisplayId: string,
  period: string,
): string {
  return `MC-${clientDisplayId}-${period.replace("-", "")}`;
}
