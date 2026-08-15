/**
 * System-wide constants that aren't sheet names, schemas, or enum value lists.
 * Default threshold/parameter VALUES here are only the seed values written into
 * SETTINGS by SettingsSheetBuilder.gs on first setup — after that, SETTINGS is
 * the live source of truth and these are not re-read at runtime except as the
 * fallback if a SETTINGS key is missing (see utils/SheetUtils.gs::getSetting).
 */
var CONST = {
  // Row range used by every ARRAYFORMULA/QUERY instead of a full-column reference.
  MAX_DATA_ROWS: 2000,

  DATE_FORMAT: 'yyyy-mm-dd',
  PERIOD_FORMAT: 'yyyy-mm',

  // Health engine thresholds (architecture.md §7). Editable via SETTINGS after setup.
  HEALTH_DELAYED_OVERDUE_COUNT: 1,      // >=1 overdue Critical task => Delayed (checked directly, not via this count)
  HEALTH_AT_RISK_OVERDUE_COUNT: 1,      // >=1 overdue task (non-critical) => at least At Risk
  HEALTH_DELAYED_TOTAL_OVERDUE_COUNT: 3, // >=3 overdue tasks of any priority => Delayed
  HEALTH_AT_RISK_DUE_SOON_DAYS: 3,      // next deadline within N days => At Risk

  // Client Request staleness (architecture.md §7 / Phase 14).
  REQUEST_STALE_DAYS: 15,

  // Monthly Close: default day-of-month (of the month AFTER period end) that
  // Month-End Close tasks are due, sourced from SETTINGS at generation time.
  MONTHLY_CLOSE_DEFAULT_DUE_DAY: 5,

  // Team Dashboard workload flag: open task count strictly greater than an
  // employee's Capacity marks them overloaded.
  WORKLOAD_OVERLOAD_MARGIN: 0,

  // Sample data idempotency flag key, stored in SETTINGS (Category="SYSTEM").
  SAMPLE_DATA_SEEDED_KEY: 'SAMPLE_DATA_SEEDED',

  // Named-range prefix for enum dropdown sources seeded into SETTINGS, e.g.
  // "SETTINGS_TASK_STATUS", "SETTINGS_PRIORITY". Built as PREFIX + enum key.
  SETTINGS_RANGE_PREFIX: 'SETTINGS_',

  // SETTINGS sheet layout: the "parameters" block (Setting Category/Key/Value/
  // Description, per SCHEMAS.SETTINGS) starts at row 2, column A. The
  // "enumerated lists" block starts several columns to the right so both zones
  // can grow independently without colliding.
  SETTINGS_PARAMS_START_ROW: 2,
  SETTINGS_LISTS_START_COLUMN: 7, // column G
  SETTINGS_LISTS_HEADER_ROW: 1,
  SETTINGS_LISTS_START_ROW: 2,
  SETTINGS_LISTS_MAX_ROWS: 30, // headroom per enum column for business users to extend

  // Protection/chart idempotency tag prefix — builders tag what they create with
  // a description starting with this prefix, then remove-by-prefix before
  // recreating, so re-running setupSpreadsheet() never duplicates them.
  MANAGED_TAG_PREFIX: '[FL-MANAGED] '
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONST: CONST };
}
