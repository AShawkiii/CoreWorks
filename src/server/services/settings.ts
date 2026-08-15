import { prisma } from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  SETTING_CATEGORY,
  type SettingKey,
} from "@/lib/domain/enums";
import type { HealthThresholds } from "@/lib/domain/types";

/**
 * Organization settings.
 *
 * Port of legacy `utils/SheetUtils.gs::getSetting` (audit §6.1): SETTINGS is
 * the live source of truth, with the constants as the fallback when a key is
 * absent. Thresholds stay configurable per organization exactly as legacy
 * intended (audit conflict C6), rather than being frozen into code.
 */

export type OrgSettings = Record<SettingKey, number>;

function parseNumeric(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  // A malformed stored value falls back rather than poisoning a calculation
  // with NaN, which would silently make every comparison false.
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getOrgSettings(
  organizationId: string,
): Promise<OrgSettings> {
  const rows = await prisma.organizationSetting.findMany({
    where: { organizationId },
    select: { key: true, value: true },
  });

  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const keys = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

  return Object.fromEntries(
    keys.map((key) => [key, parseNumeric(stored.get(key), DEFAULT_SETTINGS[key])]),
  ) as OrgSettings;
}

export function healthThresholdsFrom(settings: OrgSettings): HealthThresholds {
  return {
    delayedTotalOverdueCount: settings.HEALTH_DELAYED_TOTAL_OVERDUE_COUNT,
    atRiskOverdueCount: settings.HEALTH_AT_RISK_OVERDUE_COUNT,
    atRiskDueSoonDays: settings.HEALTH_AT_RISK_DUE_SOON_DAYS,
  };
}

/** Seeds the default settings rows for a new organization. */
export async function seedOrgSettings(organizationId: string): Promise<void> {
  const keys = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

  await prisma.organizationSetting.createMany({
    data: keys.map((key) => ({
      organizationId,
      category: SETTING_CATEGORY[key],
      key,
      value: String(DEFAULT_SETTINGS[key]),
    })),
    skipDuplicates: true,
  });
}
