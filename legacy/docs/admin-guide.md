# Admin Guide — Finance Lab Client Delivery Management System

For Finance Lab management and whoever administers this system (adjusting thresholds, managing templates, running setup). Pairs with `README.md` (install/architecture) and `docs/testing.md` (verification).

## SETTINGS sheet reference

SETTINGS has two independent zones — see `apps-script/config/SettingsSheetBuilder.gs`.

### Parameters (columns A-D)

| Category | Key | Default | Effect |
|---|---|---|---|
| HEALTH | `HEALTH_DELAYED_TOTAL_OVERDUE_COUNT` | 3 | Overdue task count at which a client becomes Delayed, regardless of priority. |
| HEALTH | `HEALTH_AT_RISK_OVERDUE_COUNT` | 1 | Overdue task count at which a client becomes At Risk. |
| HEALTH | `HEALTH_AT_RISK_DUE_SOON_DAYS` | 3 | A Critical/High task due within this many days triggers At Risk. |
| REQUESTS | `REQUEST_STALE_DAYS` | 15 | Days waiting before an outstanding client request is flagged. |
| MONTHLY_CLOSE | `MONTHLY_CLOSE_DEFAULT_DUE_DAY` | 5 | Day of the following month that Month-End Closing tasks are due. |
| WORKLOAD | `WORKLOAD_OVERLOAD_MARGIN` | 0 | Extra open-task headroom above Capacity before an employee is flagged Overloaded. |
| SYSTEM | `MAX_DATA_ROWS` | 2000 | Row range every formula spans. Must match `Constants.gs::MAX_DATA_ROWS` — raise both and re-run setup if you exceed it. |
| SYSTEM | `SAMPLE_DATA_SEEDED` | No | Internal flag — don't edit by hand; it prevents `seedSampleData()` from double-seeding. |

Edit the Value column directly. These are read live (no re-deploy needed) by `getSetting()` — see `apps-script/utils/SheetUtils.gs`.

### Enumerated lists (columns G onward)

One column per dropdown list (Task Status, Priority, Client Health, etc.), headed by its `Enums.gs` key. **Extending a list is safe** — add a new value in a blank cell below the existing ones (there's headroom for ~30 entries per list). **Renaming or removing an existing value is risky** for anything marked code-significant in `architecture.md` §5 — those exact strings are compared with `===` inside the pure-logic modules (e.g. `"Completed"`, `"Cancelled"`, `"Critical"`, `"On Hold"`, `"Active"`, `"Received"`, `"Resolved"`). Renaming one in SETTINGS without updating the corresponding `Enums.gs` constant will silently break the logic that depends on it (a task never counts as complete, monthly generation stops picking up clients, etc.). If you need to rename a code-significant value, update `apps-script/config/Enums.gs` in the same change and redeploy.

## Managing Task Templates

TASK_TEMPLATES is a normal, directly-editable sheet:

- **Add a template**: add a row. Service Package must match an existing SERVICE_PACKAGES name; Default Assignee should be an existing EMPLOYEES `Role` (not a person's name — see below); set Active? to Yes.
- **Retire a template**: set Active? to No rather than deleting the row — deleting loses the history of what it used to generate.
- **Bulk reset**: edit the seed content in `apps-script/templates/TaskTemplatesData.gs` and re-run `seedTaskTemplates()` — it only appends templates that don't already exist (matched by Service Package + Task Name), so it won't touch rows you've since customized in the sheet.

**Why Default Assignee is a role, not a person**: one template row is shared by every client on that package. `resolveDefaultAssignee()` (`apps-script/clients/ClientLogic.gs`) resolves it per client at generation time: it prefers that client's own Account Manager if their Role matches, otherwise the first active employee with that Role, otherwise falls back to the Account Manager regardless of role (so a task is never left unassigned).

## Adding a Service Area

Add a row to SERVICES with a Service ID, Name, Category, and Description. This is a catalog/reference list — it doesn't itself drive automation (TASK_TEMPLATES.Service Area is free text matched against it for consistency, not validated against it).

## Adjusting health thresholds

Change the HEALTH category values in SETTINGS' Parameters block (see table above) — takes effect on the next recalculation (daily trigger, or **Finance Lab → Run: Recalculate All**), no redeploy needed.

## Re-running setup safely

`setupSpreadsheet()` is idempotent — safe to run any time, including after every code update:

- Never deletes a CLIENTS/TASKS/etc. data row.
- Rebuilds headers, formulas, dropdowns, protections, conditional formatting, and charts from scratch each time (removing its own previously-created ones first, so nothing duplicates).
- Re-installs the 4 managed triggers (`dailyRecalculation`, `runMonthlyTaskGeneration`, `generateMonthlyManagementReport`, `onEditHandler`), removing old copies first.
- Does NOT call `buildCustomMenu()` — that needs a live editor UI context, which a script run from the editor may or may not have depending on how it's invoked; `onOpen()` builds the menu automatically the next time anyone opens the sheet.

Run it after: first deployment, any code update via `clasp push`, or if you suspect protections/validation have drifted from what the code expects.

## Trigger management

Installed by `setupSpreadsheet()` → `installTimeDrivenTriggers()` (`apps-script/automation/Triggers.gs`):

| Trigger | Fires | Purpose |
|---|---|---|
| `dailyRecalculation` | Daily, ~2am | Refreshes every client's progress/health and the Control Center/Team dashboards — the safety net for anything that changed without a specific edit (e.g. a due date rolling into "overdue" with no user action). |
| `runMonthlyTaskGeneration` | Monthly, day 1, ~3am | Generates that month's recurring tasks for all Active clients. |
| `generateMonthlyManagementReport` | Monthly, day 1, ~4am | Rebuilds MANAGEMENT_REPORT. |
| `onEditHandler` | Every edit | Validates manual TASKS.Status changes, re-renders Client/Monthly-Close dashboards when their filter cells change. |

View/manage these manually via the Apps Script editor's Triggers page (clock icon) if needed — but prefer re-running `setupSpreadsheet()` over hand-editing triggers, so the managed set stays consistent with the code.

## Protection management

Computed columns (Days Remaining/Overdue, Days Waiting/Bucket, Client Health, both Completion % columns, Last Activity/Next Deadline, Monthly Close's Completion %/Close Status, all of ACTIVITY_LOG) are sheet-protected against manual edits — they're written by the scripts, not typed by hand. If you need to grant a specific person edit access to a normally-protected range (e.g. to correct a data error), do it via Google Sheets' own sharing/protection UI (right-click the range → "View range permissions") — don't remove the protection via code, since the next `setupSpreadsheet()` run will just re-apply it.

## Least-privilege recommendation

Only the spreadsheet owner and people who need to adjust SETTINGS/CONTROL_CENTER should have Editor access to the whole file. Staff who only need to update task status day-to-day can be scoped (via Sheets' per-sheet protection) to Edit rights on TASKS/CLIENT_REQUESTS/ISSUES and Viewer elsewhere. Full role-based access control is a V2/web-app concern — see `docs/future-architecture.md`.
