# CoreWorks — Architecture Audit (Phase 0)

**Status:** Complete
**Audited system:** Finance Lab Client Delivery Management System (V1) — Google Sheets + Google Apps Script
**Source:** `AShawkiii/finance-lab-client-system` @ `bf74f0b29398af6e67f23b2061b182b81d29da12`
**Preserved in this repo at:** [`/legacy`](../legacy) — byte-for-byte mirror, 98 files, verified against the source git index with zero drift
**Method:** Every `.gs` file containing business logic was read in full. No rule in this document is inferred from naming, documentation, or assumption — each is cited to `file:line` in `/legacy`.

> **Reading rule for this document.** Where the legacy *code* and the legacy *documentation* disagree, the code is recorded as the truth and the discrepancy is logged in §12. Where the legacy code and the CoreWorks master prompt disagree, both are recorded in §13 and the conflict is escalated rather than silently resolved.

---

## 1. Executive summary

The legacy system is **substantially better engineered than a typical spreadsheet application**, and that materially changes the migration strategy.

Its author deliberately split every engine into two files:

- **`*Logic.gs`** — pure functions. Zero `SpreadsheetApp` / `Session` / `Utilities` references. Plain JavaScript in, plain JavaScript out.
- **`*Service.gs` / `*Engine.gs`** — I/O wrappers that read sheet rows, call the pure function, and write results back.

This was done *on purpose, for exactly this migration*. The legacy repo contains [`docs/future-architecture.md`](../legacy/docs/future-architecture.md), which specifies a Next.js + Node + PostgreSQL target, maps `Schemas.gs` header arrays to tables, and anticipates the role model. The audit conclusion follows directly:

> **The `*Logic.gs` files are the migration payload, not a rewrite target.** They port to TypeScript near-verbatim. Only the I/O wrappers get rewritten against Prisma. This is a *port*, not a reimplementation, and every rule in §6 must survive with identical behavior.

**Scale:** 7,852 LOC across 90 tracked files. **Test baseline:** 111 unit tests, 110 passing (§11).

| Area | Legacy maturity | Migration action |
|---|---|---|
| Business rules (health, progress, dates, IDs, templates) | **Strong** — pure, tested, documented | **Port near-verbatim** |
| Data model | **Strong** — normalized-ish, explicit schemas, ID scheme | Port + normalize (§14) |
| Dashboards / KPIs | **Strong** — two parallel implementations (§8) | Port the Web App view-model variant |
| Activity logging | **Good** — single append path, semantic events | Port + extend |
| Authentication | **Minimal** — email allowlist against `EMPLOYEES` | **Replace** (net-new, §10) |
| Authorization / roles | **Absent** — no RBAC of any kind exists | **Build net-new** (§10, §15) |
| Multi-tenancy | **Absent** — single implicit tenant | **Build net-new** (§15) |
| Theming / branding | **Absent** — hardcoded "Finance Lab", fixed palette | **Build net-new** (§15) |
| Notifications | **Absent** | **Build net-new** (§15) |
| Attachments / comments | **Absent** | **Build net-new** (§15) |

---

## 2. Module inventory

All 90 tracked files, grouped as they exist in `/legacy/apps-script/`.

### `config/` — 482 LOC · configuration & vocabulary
| File | Responsibility |
|---|---|
| `SheetNames.gs` | Registry of all 17 sheet tab names; `DATA_SHEET_KEYS` (11 real data tables) |
| `Enums.gs` | **Canonical enumerations** — values, colors, weights, open/closed partitions (§5) |
| `Schemas.gs` | Header row (column order + names) for all 11 data sheets; `col()` / `headerRow()` accessors |
| `Constants.gs` | Thresholds, formats, layout constants; seed values for `SETTINGS` |
| `Setup.gs` | `setupSpreadsheet()` — idempotent full-system builder |
| `SettingsSheetBuilder.gs` | Builds `SETTINGS` (key/value params + named-range enum list zone) |

### `clients/` — 246 LOC
| File | Responsibility |
|---|---|
| `ClientLogic.gs` | **Pure** — `validateClientFields`, `isDuplicateClient`, `resolveDefaultAssignee` |
| `ClientService.gs` | `createNewClient()` — validate → ID → append → onboarding tasks → log → recalc |
| `HealthLogic.gs` | **Pure** — `computeClientHealth()` (the core health rule set) |
| `HealthEngine.gs` | `recalculateClientHealth()` / `recalculateAllClientsHealth()` — gathers stats, writes result, logs health changes |
| `ClientsSheetBuilder.gs` | Builds `CLIENTS` sheet |
| `EmployeesSheetBuilder.gs` | Builds `EMPLOYEES` sheet |

### `tasks/` — 474 LOC
| File | Responsibility |
|---|---|
| `TaskLogic.gs` | **Pure** — `TASK_STATUS_TRANSITIONS` state machine, `isTaskOpen`, `nextStatusAllowed`, `validateTaskFields` |
| `TaskService.gs` | `createTask`, `updateTaskStatus`, `reassignTask`, `getTasksForClient`, `getOpenTasksForEmployee` |
| `ProgressLogic.gs` | **Pure** — `computeSimpleCompletion`, `computeWeightedCompletion`, `computeNextDeadline` |
| `ProgressEngine.gs` | `recalculateClientProgress()` / `...AllClients...` |
| `TaskGenerationOnboarding.gs` | `generateOnboardingTasks()` |
| `TaskGenerationMonthly.gs` | `generateMonthlyTasks()`, `runMonthlyTaskGeneration()` |
| `WorkloadLogic.gs` | **Pure** — `isOverloaded()` |
| `TasksSheetBuilder.gs`, `MonthlyCloseSheetBuilder.gs` | Sheet builders |

### `templates/` — 333 LOC
| File | Responsibility |
|---|---|
| `TemplateExpansionLogic.gs` | **Pure** — `expandTemplateToTask`, `taskDedupeKey` (the single template→task rule) |
| `TaskTemplateService.gs` | `getActiveTemplatesForPackage`, `seedTaskTemplates` |
| `TaskTemplatesData.gs` | The actual catalog content — 3 package tiers, inheritance + dedupe rules |
| `ServicesSheetBuilder.gs`, `ServicePackagesSheetBuilder.gs`, `TaskTemplatesSheetBuilder.gs` | Sheet builders |

### `issues/` — 95 LOC
| File | Responsibility |
|---|---|
| `IssueLogic.gs` | **Pure** — `isIssueOpen`, `isUnresolvedCriticalOrHigh`, `isOverdueIssue`, **`selectSurfacedIssues`** |
| `IssueService.gs` | `getSurfacedIssuesForControlCenter()` and issue CRUD |
| `IssuesSheetBuilder.gs` | Sheet builder |

### `requests/` — 139 LOC
| File | Responsibility |
|---|---|
| `ClientRequestLogic.gs` | **Pure** — `isRequestOpen`, `flagStaleRequests`, `topClientsByOutstandingRequests` |
| `ClientRequestService.gs` | Request CRUD |
| `ClientRequestsSheetBuilder.gs` | Sheet builder (owns the live `Days Waiting` ARRAYFORMULA) |

### `dashboards/` — 1,018 LOC
| File | Responsibility |
|---|---|
| `ControlCenterEngine.gs` / `ControlCenterSheetBuilder.gs` | `CC_LAYOUT`, 9 KPI formulas, health table, surfaced issues, charts area |
| `ClientDashboardEngine.gs` / `ClientDashboardSheetBuilder.gs` | Per-client dashboard: info block, 7 summary cards, service progress, current tasks, requests, issues, deadlines |
| `TeamDashboardEngine.gs` / `TeamDashboardSheetBuilder.gs` | Per-employee workload table |
| `MonthlyCloseDashboardEngine.gs` / `MonthlyCloseDashboardSheetBuilder.gs` | Per-client-per-month close view, 18 stage columns |
| `ManagementReportLogic.gs` (**pure**) / `ManagementReportEngine.gs` | 4-section monthly management report |
| `Charts.gs`, `ChartSourceSheetBuilder.gs` | 6 charts + hidden `_CHART_SRC` pivot source |
| `DashboardQueryUtils.gs`, `DashboardLayoutUtils.gs`, `NavigationUtils.gs` | Shared helpers |

### `automation/` — 461 LOC
| File | Responsibility |
|---|---|
| `ActivityLogger.gs` | `logActivity()` — the single append path for `ACTIVITY_LOG`; also stamps `CLIENTS.Last Activity` |
| `Triggers.gs` | `onOpen`, `onEditHandler`, `dailyRecalculation`, trigger install/remove |
| `Menu.gs` | Custom spreadsheet menu |
| `SeedSampleData.gs`, `SeedSampleDataConstants.gs`, `ActivityLogSheetBuilder.gs` | Demo seeding, log sheet builder |

### `utils/` — 536 LOC
| File | Responsibility |
|---|---|
| `DateLogic.gs` | **Pure** — all date/period math (§6.4). The most reused module in the system. |
| `IdLogic.gs` (**pure**) / `IdService.gs` | `nextSequentialId`, `ID_CONFIG` prefix table, `buildMonthlyCloseId` |
| `SheetUtils.gs` | `getAllRows`, `appendRow`, `updateRowById`, `getSetting` — the data-access layer |
| `ValidationUtils.gs`, `ProtectionUtils.gs`, `FormattingUtils.gs` | Dropdowns, sheet protection, number/date formats |

### `webapp/` — 4,068 LOC
| File | Responsibility |
|---|---|
| `WebAppEntry.gs` | `doGet()`, `getRequestingUserEmail()`, `checkWebAppAccess()` — the entire auth model (§10) |
| `ControlCenterViewModelLogic.gs` | **Pure** — `buildControlCenterViewModel`, **`buildControlCenterKpis`** (14 KPIs), **`buildClientHealthRows`**, `buildSurfacedIssueRows`, **`healthSortRank`** |
| `ClientsViewModelLogic.gs` | **Pure** — `buildClientsListViewModel`, **`buildClientDetailViewModel`**, detail row builders, `issueSeverityRank` |
| `ControlCenterViewModelService.gs`, `ClientsViewModelService.gs` | I/O wrappers |
| `Index.html` (2,551 LOC), `AppScript.html`, `Styles.html`, `AccessDenied.html` | The browser UI — **fully superseded by the CoreWorks Next.js frontend** |

### Repository artifacts (non-code)
`architecture.md` (155), `requirements.md` (47), `changelog.md` (51), `docs/{admin,user,webapp,testing,future-architecture}-guide.md`, `tests/` (9 suites), `package.json`, `.clasp.json`.

**Junk artifacts:** `apps-script/0`, `apps-script/cd`, `apps-script/clasp`, `apps-script/type` — four zero-byte files from a shell mishap during the original commit. Preserved in `/legacy` for mirror fidelity; **not migrated**.

---

## 3. Entity model

Eleven real data tables. `CONTROL_CENTER`, `CLIENT_DASHBOARD`, `TEAM_DASHBOARD`, `MONTHLY_CLOSE_DASHBOARD`, `MANAGEMENT_REPORT`, `_CHART_SRC` are rendered views, **not** sources of truth.

| Entity | Sheet | Key | Represents |
|---|---|---|---|
| Client | `CLIENTS` | `CL-0001` | A company the firm serves |
| Employee | `EMPLOYEES` | `EMP-001` | A staff member who can be assigned work |
| Service | `SERVICES` | `SVC-001` | One line in the service catalog |
| Service Package | `SERVICE_PACKAGES` | `PKG-001` | A named bundle sold to a client |
| Task Template | `TASK_TEMPLATES` | `TPL-001` | Reusable recurring-work definition |
| Task | `TASKS` | `TSK-000001` | Concrete unit of work, one client, one period |
| Client Request | `CLIENT_REQUESTS` | `REQ-0001` | Something awaited *from* the client |
| Issue | `ISSUES` | `ISS-0001` | A problem/risk affecting delivery |
| Activity | `ACTIVITY_LOG` | `ACT-0000001` | Audit trail entry |
| Monthly Close | `MONTHLY_CLOSE` | `MC-CL-0007-202608` | One client × one month close instance |
| Setting | `SETTINGS` | (key) | Config params + enum list zone |

### 3.1 Full column inventory

Source: [`config/Schemas.gs`](../legacy/apps-script/config/Schemas.gs).

**CLIENTS** (23): Client ID, Client Name, Company Name, Industry, Business Type, **Start Date**, Service Package, Account Manager, Backup Team Member, Client Contact, Email, Phone, **Accounting System**, **Reporting Frequency**, **Month-End Closing Date**, Contract Status, Priority, Client Health, Simple Completion %, Weighted Completion %, Last Activity, Next Deadline, Notes

> Bolded columns are **absent from the CoreWorks master prompt §10 field list** but exist in the legacy system. Per rule 7, they are preserved.

**EMPLOYEES** (9): Employee ID, Employee Name, Role, Department, Email, Active?, Manager, **Capacity**, Notes
> `Capacity` drives the workload-overload rule (§6.7).

**SERVICES** (5): Service ID, Service Name, Category, Description, Active?

**SERVICE_PACKAGES** (5): Package ID, Package Name, Description, Included Service Areas, Active?

**TASK_TEMPLATES** (11): Template ID, Service Package, Service Area, Task Name, Description, Frequency, Priority, Default Assignee, Typical Duration (Days), Required Client Input?, Active?

**TASKS** (25): Task ID, Client ID, Client Name, Service Area, Task Category, Task Name, Description, **Period**, Frequency, Assigned To, Priority, Status, Start Date, Due Date, Completion Date, Days Remaining, Days Overdue, **Waiting For**, **Client Dependency**, Completion %, Reviewer, Review Status, Notes, Created Date, Last Updated

**CLIENT_REQUESTS** (13): Request ID, Client ID, Client, Request, Requested Date, Required By, Status, Days Waiting, Days Waiting Bucket, Priority, Assigned To, **Received Date**, Notes

**ISSUES** (14): Issue ID, Client ID, Client, Issue, Category, Date Raised, Severity, Assigned To, Status, **Impact**, Required Action, Deadline, Resolution Date, Notes

**ACTIVITY_LOG** (10): Activity ID, Date, User, Client, Entity Type, Entity ID, Action, Previous Value, New Value, Comment

**MONTHLY_CLOSE** (23): Close ID, Client, Month, then **18 stage columns**, then Close Status, Completion %.
The 18 stages (`MONTHLY_CLOSE_STAGE_COLUMNS = SCHEMAS.MONTHLY_CLOSE.slice(3, 21)`):
> Sales · COGS · Expenses · Bank Reconciliation · AP · AR · Inventory · Fixed Assets · Accruals · Prepayments · Payroll · Intercompany · Trial Balance · P&L · Balance Sheet · Cash Flow · Management Review · Final Approval

**SETTINGS** (4): Setting Category, Setting Key, Value, Description

### 3.2 Relationships

Legacy joins by **string match**, not FK — a spreadsheet constraint, not a design intent. Note the inconsistency, which CoreWorks must normalize:

- `TASKS.Client ID` → `CLIENTS.Client ID` *(by ID — good)*
- `ISSUES.Client ID`, `CLIENT_REQUESTS.Client ID` → `CLIENTS.Client ID` *(by ID — good)*
- `ACTIVITY_LOG.Client` → `CLIENTS.Client Name` ⚠️ *(by **name** — breaks on rename)*
- `MONTHLY_CLOSE.Client` → `CLIENTS.Client Name` ⚠️ *(by **name**)*
- `TASKS.Assigned To`, `CLIENTS.Account Manager` → `EMPLOYEES.Employee Name` ⚠️ *(by **name**)*
- `TASKS` ↛ `TASK_TEMPLATES` — **no FK stored at all**; dedupe keys on (Client ID, Service Area, Task Name, Period) instead

---

## 4. ID scheme

[`utils/IdLogic.gs`](../legacy/apps-script/utils/IdLogic.gs) + [`IdService.gs`](../legacy/apps-script/utils/IdService.gs). Sequential, prefixed, zero-padded. `nextSequentialId` scans existing IDs for the highest matching suffix and adds 1, **ignoring malformed IDs** so a stray row can't corrupt numbering.

| Entity | Prefix | Pad | Example |
|---|---|---|---|
| Client | `CL-` | 4 | `CL-0007` |
| Employee | `EMP-` | 3 | `EMP-012` |
| Task | `TSK-` | 6 | `TSK-004321` |
| Task Template | `TPL-` | 3 | `TPL-014` |
| Client Request | `REQ-` | 4 | `REQ-0088` |
| Issue | `ISS-` | 4 | `ISS-0021` |
| Activity | `ACT-` | 7 | `ACT-0001234` |
| Service | `SVC-` | 3 | `SVC-014` |
| Service Package | `PKG-` | 3 | `PKG-003` |
| Monthly Close | composite | — | `MC-CL-0007-202608` |

> **Migration note.** These IDs are **user-facing** — staff refer to "TSK-004321" in conversation. CoreWorks must keep them as a human-readable `displayId` alongside a UUID primary key. A scan-max-and-increment generator is also a **race condition** under real concurrency (two simultaneous creates yield the same ID); CoreWorks must replace the mechanism with a per-organization DB sequence while preserving the format. See §14.

---

## 5. Canonical enumerations

Source: [`config/Enums.gs`](../legacy/apps-script/config/Enums.gs). **[CS]** = code-significant: compared with `===` inside pure logic; renaming breaks automation.

| Enum | Values |
|---|---|
| **Task Status** (7) | Not Started · In Progress · Waiting Client · Blocked · **In Review** · Completed **[CS]** · Cancelled **[CS]** |
| ↳ open | Not Started, In Progress, Waiting Client, Blocked, In Review |
| ↳ closed | Completed, Cancelled |
| **Priority** (4) | Low · Medium · High · Critical **[CS]** |
| ↳ **weights** | Low=**1**, Medium=**2**, High=**3**, Critical=**4** |
| **Client Health** (4) | On Track 🟢 · At Risk 🟡 · Delayed 🔴 · On Hold ⚪ **[CS]** |
| **Contract Status** (5) | Onboarding · Active **[CS]** · On Hold · Completed · Cancelled |
| **Request Status** (5) | Requested · Partially Received · Received **[CS]** · Not Available · Cancelled |
| ↳ open / closed | {Requested, Partially Received} / {Received, Not Available, Cancelled} |
| **Days Waiting Bucket** (4) | 0-3 · 4-7 · 8-14 · 15+ |
| **Issue Severity** (4) | Low · Medium · High · Critical **[CS]** |
| **Issue Status** (4) | Open · In Progress · Resolved **[CS]** · Cancelled |
| ↳ open / closed | {Open, In Progress} / {Resolved, Cancelled} |
| **Review Status** (4) | Not Reviewed · In Review · Approved · Changes Requested |
| **Frequency** (6) | Daily · Weekly · Monthly · Quarterly · Annually · One-Time |
| **Reporting Frequency** (3) | Weekly · Monthly · Quarterly |
| **Close Stage Status** (5) | Not Started · In Progress · Completed **[CS]** · Blocked · Waiting Client |
| **Close Status** (4) | Not Started · In Progress · Blocked · Closed |
| **Active Flag** (2) | Yes · No |
| **Service Package Name** (3) | Basic Accounting · Full Finance · CFO / FP&A |
| **Entity Type** (8) | Client · Employee · Task · Task Template · Client Request · Issue · Monthly Close · System |

`Priority.weights` is load-bearing in **three** distinct places: weighted completion (§6.2), issue surfacing severity sort (§6.5), and client-detail issue ordering. It is not merely display metadata.

---

## 6. Business rules catalog

**This is the source of truth CoreWorks must preserve.** Each rule cites its legacy implementation.

### 6.1 Client Health
[`clients/HealthLogic.gs:19-39`](../legacy/apps-script/clients/HealthLogic.gs)

Evaluated strictly in order; first match wins:

```
1. contractStatus === 'On Hold'                          → 'On Hold'    (hard override, checked first)

2. criticalOverdueCount > 0                              → 'Delayed'
   OR overdueCount >= delayedTotalOverdueCount (default 3)
   OR openCriticalIssueCount > 0

3. overdueCount >= atRiskOverdueCount (default 1)        → 'At Risk'
   OR (daysToNextImportantDeadline !== null
       AND >= 0 AND <= atRiskDueSoonDays (default 3))
   OR openHighIssueCount > 0

4. otherwise                                             → 'On Track'
```

**Input gathering** — [`clients/HealthEngine.gs:9-58`](../legacy/apps-script/clients/HealthEngine.gs):
- `overdueCount` / `criticalOverdueCount` — recomputed from raw `Due Date` + `Status` via `computeDaysOverdue`, **deliberately not** read from the sheet's formula column, so the engine is correct the instant a status changes.
- `openCriticalIssueCount` / `openHighIssueCount` — open issues with Severity Critical / High.
- `daysToNextImportantDeadline` — **scoped to Critical/High priority open tasks only**. The legacy comment explains why: including all priorities would make every client with routine weekly work permanently "At Risk", destroying the signal. **This subtlety must survive migration.**
- Thresholds read from `SETTINGS` with `Constants.gs` fallbacks → in CoreWorks these become per-organization configurable values.
- On change, writes `CLIENTS.Client Health` and logs a `Client Health Changed` activity.

### 6.2 Completion percentages
[`tasks/ProgressLogic.gs`](../legacy/apps-script/tasks/ProgressLogic.gs)

Both metrics use the **same population**: all tasks for the client **excluding `Cancelled`** — so they are always comparable.

- **Simple Completion %** = `count(Status === 'Completed') / count(Status !== 'Cancelled')`; `0` when denominator is 0.
- **Weighted Completion %** = `Σ weight(completed) / Σ weight(all non-cancelled)`, weight from `Priority.weights`, **unknown/missing priority weighs 1**; `0` when denominator is 0.
- **Next Deadline** = earliest `Due Date` among **open** tasks with a due date; `''` if none.

### 6.3 Task status state machine
[`tasks/TaskLogic.gs:9-29`](../legacy/apps-script/tasks/TaskLogic.gs)

| From | Allowed to |
|---|---|
| Not Started | In Progress, Cancelled |
| In Progress | Waiting Client, Blocked, In Review, Completed, Cancelled |
| Waiting Client | In Progress, Blocked, Cancelled |
| Blocked | In Progress, Waiting Client, Cancelled |
| In Review | In Progress, Completed, Cancelled |
| Completed | **In Progress only** (reopen for correction) |
| Cancelled | **∅ — terminal** |

Same-status transitions are always an allowed no-op. Notable consequences, all intentional:
- **Not Started → Completed is forbidden.** Work must pass through In Progress.
- **Waiting Client → Completed is forbidden.** Must return to In Progress first.
- **Cancelled is a dead end.** Create a new task instead.

**Side effects on transition** — [`tasks/TaskService.gs:49-73`](../legacy/apps-script/tasks/TaskService.gs): → Completed sets `Completion Date = now`, `Completion % = 1`; reopening from Completed **clears** `Completion Date`. Every real change stamps `Last Updated` and logs `Task Status Changed`.

### 6.4 Date & period logic
[`utils/DateLogic.gs`](../legacy/apps-script/utils/DateLogic.gs) — all math is whole-day; `toDateOnly()` strips time first.

| Function | Rule |
|---|---|
| `computeDaysRemaining(due, status, today)` | `''` if no due date **or task closed**; else `due − today` (negative once overdue) |
| `computeDaysOverdue(due, status, today)` | `0` if no due date or closed; else `max(0, today − due)` |
| `computeDaysWaiting(requested, status, today, received)` | Open → `today − requested`. Closed → **frozen** at `received − requested`; `''` if closed with no received date |
| `bucketDaysWaiting(days)` | `''` passes through · `≤3`→`0-3` · `≤7`→`4-7` · `≤14`→`8-14` · else `15+` |
| `frequencyHitsPeriod(freq, period, isFirst)` | One-Time → only first period · Quarterly → months **3,6,9,12** · Annually → month **12** · Daily/Weekly/Monthly → **every period** |
| `computeTaskDueDate(period, area, duration, closeDay)` | `Month-End Closing` → day `closeDay` (default 5) of the **following** month. All others → **last day of the period's month + Typical Duration (Days)** |
| `formatPeriod(date)` | `YYYY-MM` |

> `frequencyHitsPeriod` collapses Daily/Weekly into one monthly checklist row rather than generating literal daily rows — a V1 simplification, explicitly documented. CoreWorks should preserve the behavior initially and treat true sub-monthly recurrence as a future enhancement.

### 6.5 Issue surfacing — `selectSurfacedIssues`
[`issues/IssueLogic.gs:19-26`](../legacy/apps-script/issues/IssueLogic.gs)

```
FILTER: isUnresolvedCriticalOrHigh(issue)  OR  isOverdueIssue(issue, today)
  where isUnresolvedCriticalOrHigh = isIssueOpen(status) AND severity ∈ {Critical, High}
  where isOverdueIssue             = isIssueOpen(status) AND deadline AND (today − deadline) > 0
SORT:   severity weight DESC (Priority.weights), then Date Raised ASC (oldest first)
```
This exact function powers **both** the spreadsheet Control Center and the Web App. It is the single authority for "issues needing attention" and must not be re-derived.

### 6.6 Client health sort order — `healthSortRank`
[`webapp/ControlCenterViewModelLogic.gs:116-126`](../legacy/apps-script/webapp/ControlCenterViewModelLogic.gs)

`{ Delayed: 0, At Risk: 1, On Track: 2, On Hold: 3 }`, unknown → `99`. Sort by rank ascending, then **client name alphabetically**.

> Implemented with `hasOwnProperty`, **not** `rank[health] || 99`. The legacy comment documents why: `Delayed` ranks `0`, which is falsy, so the `||` idiom would silently demote the most urgent clients to unranked. **Preserve this defensive detail** — a naive TypeScript port using `??`/`||` reintroduces the bug.

### 6.7 Workload
[`tasks/WorkloadLogic.gs`](../legacy/apps-script/tasks/WorkloadLogic.gs): `isOverloaded(openCount, capacity, margin)` → `false` if capacity unset (never guess); else `openCount > capacity + margin`. Default margin `0`. **A capacity of exactly `0` is a valid value, not "unset"** — covered by a dedicated legacy test.

### 6.8 Client request aging
[`requests/ClientRequestLogic.gs`](../legacy/apps-script/requests/ClientRequestLogic.gs): `flagStaleRequests` returns IDs of **open** requests with `Days Waiting >= threshold` (default **15**). `topClientsByOutstandingRequests` counts open requests per client, descending, default top 5.

### 6.9 Client creation & onboarding
[`clients/ClientService.gs:14-43`](../legacy/apps-script/clients/ClientService.gs)

Required: **Client Name, Service Package, Account Manager, Start Date** ([`ClientLogic.gs:5-12`](../legacy/apps-script/clients/ClientLogic.gs)).
Duplicate rule: rejected when **both** Client Name *and* Company Name match an existing row.
Defaults: Contract Status `Onboarding`, Priority `Medium`, Client Health `On Track`, both completion % `0`, Next Deadline `''`.
Sequence: validate → dedupe → generate ID → append → log `Client Added` → **generate onboarding tasks** → recalc progress → recalc health.

### 6.10 Default assignee resolution
[`clients/ClientLogic.gs:29-38`](../legacy/apps-script/clients/ClientLogic.gs) — templates carry a **role**, not a person. Resolution order:
1. The client's Account Manager, **if their role matches** the template role.
2. Else the first **active** employee with that role.
3. Else the Account Manager regardless of role — *so a task is never left unassigned*.

### 6.11 Task generation
**Onboarding** ([`TaskGenerationOnboarding.gs`](../legacy/apps-script/tasks/TaskGenerationOnboarding.gs)): expands every active template for the client's package into the **current** period. Duplicate-safe. Uses the **same due-date rule** as monthly generation — explicitly *not* "today + duration", because same-day due dates made every new client look At Risk immediately.

**Monthly** ([`TaskGenerationMonthly.gs`](../legacy/apps-script/tasks/TaskGenerationMonthly.gs)): for **Active clients only**, for each active template whose frequency hits the period, create a task unless the dedupe key exists. Logs **one summary activity** per run, not one per task.

**Shared expansion** ([`TemplateExpansionLogic.gs`](../legacy/apps-script/templates/TemplateExpansionLogic.gs)): the single template→task mapping. New tasks start `Status='Not Started'`, `Completion %=0`, `Review Status='Not Reviewed'`, `Client Dependency` from `Required Client Input?`. `Task Category` is `'Onboarding'` / `'Recurring'` / `'Ad-Hoc'`.

**Idempotency key:** `clientId|serviceArea|taskName|period`. This is what makes generation safe to re-run and preserves history across months — **prior periods are never touched**.

### 6.12 Service package catalog
[`templates/TaskTemplatesData.gs`](../legacy/apps-script/templates/TaskTemplatesData.gs) — each tier gets its **own full set** of template rows (queried by exact package match), not a reference to shared rows.

- **Basic Accounting** — 9 tasks (Daily Bookkeeping, Bank Reconciliation, AP, AR, GL Review, Month-End Close, Monthly P&L, Monthly Balance Sheet, Monthly Cash Flow)
- **Full Finance** — Basic's 9 **+ 7** (Budget, Sales Forecast, Cash Forecast, Budget vs Actual, KPI Reporting, Variance Analysis, Management Reporting) = **16**
- **CFO / FP&A** — Full Finance's 16 **+ 6**, **deduplicated by task name** = **21**

### 6.13 Monthly close
Completion % = `COUNTIF(18 stages, "Completed") / COUNTA(stages)`. Close Status derived from completion % and presence of any Blocked stage. Close ID = `MC-<ClientID>-<YYYYMM>`.
Dashboard summary ([`MonthlyCloseDashboardEngine.gs`](../legacy/apps-script/dashboards/MonthlyCloseDashboardEngine.gs)) counts **all** tasks for that client+period — not only `Service Area = 'Month-End Closing'` — because "the close" spans every deliverable due that period. `Pending` = open AND not Blocked AND not Waiting Client.

### 6.14 Activity logging
[`automation/ActivityLogger.gs`](../legacy/apps-script/automation/ActivityLogger.gs) — one append path. Records Activity ID, Date, User, Client, Entity Type, Entity ID, Action, Previous Value, New Value, Comment. **Also stamps `CLIENTS.Last Activity`** — this is the only place that column is written.

Logged actions found in code: `Client Added`, `Client Health Changed`, `Task Created`, `Task Status Changed`, `Task Reassigned`, `Onboarding Tasks Generated`, `Monthly Tasks Generated`.

**Explicit non-goal:** pure recalculation writes and dashboard renders are *never* logged. Bulk generators pass `skipLog: true` and emit one summary entry.

---

## 7. Calculated fields

| Field | Sheet | Legacy mechanism | CoreWorks |
|---|---|---|---|
| Days Remaining | TASKS | live ARRAYFORMULA | Derived server-side on read |
| Days Overdue | TASKS | live ARRAYFORMULA | Derived server-side on read |
| Days Waiting | CLIENT_REQUESTS | live ARRAYFORMULA | **Server-side** (master prompt §15) |
| Days Waiting Bucket | CLIENT_REQUESTS | live ARRAYFORMULA | Derived server-side |
| Simple / Weighted Completion % | CLIENTS | script-computed, stored | Stored, recomputed on task change |
| Client Health | CLIENTS | script-computed, stored | Stored, recomputed on task/issue change |
| Last Activity / Next Deadline | CLIENTS | script-computed, stored | Stored |
| Monthly Close Completion % / Status | MONTHLY_CLOSE | live formula | Derived server-side |

The legacy split (live formula for date math, script for cross-entity aggregates) exists because Sheets formulas can't be trusted to be fresh for aggregates. **In CoreWorks this distinction disappears** — everything is computed server-side. Stored-vs-derived becomes purely a caching decision.

---

## 8. Dashboards & KPIs

> **Critical finding: the Control Center exists in two parallel implementations with different KPI sets.**

### 8.1 Spreadsheet Control Center — **9 KPIs**
[`ControlCenterSheetBuilder.gs:78-102`](../legacy/apps-script/dashboards/ControlCenterSheetBuilder.gs), as live formulas:

Total Clients · Active Clients · Onboarding · On Hold · Overall Completion % · Open Tasks · Overdue Tasks · Waiting Client · Blocked Tasks

Health table columns: Client · Account Manager · Progress · Open Tasks · Overdue · Waiting Client · Next Deadline · Health

### 8.2 Web App Control Center — **14 KPIs** ← *the superset*
[`ControlCenterViewModelLogic.gs:34-72`](../legacy/apps-script/webapp/ControlCenterViewModelLogic.gs):

| Key | Label | Rule |
|---|---|---|
| `totalClients` | Total Clients | `clients.length` |
| `activeClients` | Active Clients | Contract Status = Active |
| `onboardingClients` | Onboarding | Contract Status = Onboarding |
| `onHoldClients` | On Hold | Contract Status = On Hold |
| `clientsAtRisk` | Clients At Risk | Client Health = At Risk |
| `clientsDelayed` | Clients Delayed | Client Health = Delayed |
| `overallCompletionPct` | Overall Completion % | **mean of `Weighted Completion %` across ALL clients** |
| `openTasks` | Open Tasks | non-cancelled AND open |
| `overdueTasks` | Overdue Tasks | `computeDaysOverdue > 0` |
| `tasksCompleted` | Tasks Completed | Status = Completed |
| `waitingOnClient` | Waiting on Client | Status = Waiting Client |
| `blockedTasks` | Blocked Tasks | Status = Blocked |
| `openIssues` | Open Issues | `isIssueOpen` |
| `issuesNeedingAttention` | Issues Needing Attention | `selectSurfacedIssues().length` |

**These 14 match the CoreWorks master prompt §16 list exactly** — confirming the prompt was written against the Web App view model. **This is the variant to migrate.**

Two behaviors to preserve deliberately:
- Task KPIs are **unscoped by client contract status** — they count across *all* clients, matching the spreadsheet's `COUNTIF` formulas.
- `overallCompletionPct` is a **plain mean of per-client percentages**, not a task-weighted global figure. A 3-task client and a 300-task client contribute equally. This is a real modelling choice; preserve it and flag it for product review.

### 8.3 Web App client health table
[`buildClientHealthRows`](../legacy/apps-script/webapp/ControlCenterViewModelLogic.gs) — **filtered to `Contract Status === 'Active'` only.** Columns: Client · Service Package · Account Manager · Health · Completion % (weighted) · Overdue Tasks · Waiting on Client · Open Issues · Next Deadline. Sorted by `healthSortRank` then name.

> The master prompt §17 specifies these columns and this sort, but **does not mention the Active-only filter**. Preserved and flagged (§13).

### 8.4 Client Dashboard
[`ClientDashboardEngine.gs`](../legacy/apps-script/dashboards/ClientDashboardEngine.gs) — 7 summary cards (Total, Completed, In Progress, Not Started, Waiting Client, Blocked, Overdue) + service-area progress + open tasks by due date + open requests + open issues + upcoming deadlines.

### 8.5 Team Dashboard
[`TeamDashboardEngine.gs`](../legacy/apps-script/dashboards/TeamDashboardEngine.gs) — per employee: Name, Role, Assigned, Completed, In Progress, Overdue, Waiting Client, Critical (open only), Completion %, Capacity, **Overloaded/OK**.

### 8.6 Management Report
[`ManagementReportLogic.gs`](../legacy/apps-script/dashboards/ManagementReportLogic.gs) — 4 sections: Client Performance (grouped by health, On Track sorted by weighted % desc) · Team Performance (per employee) · Operational Risks (overdue tasks, critical issues, blocked tasks, outstanding requests) · **Management Attention** — ordered by category *Delayed Clients → Critical Issues → Blocked Tasks → Stale Requests*, **capped at 15 items**.

### 8.7 Charts
Six, from `_CHART_SRC`: Client Progress · Tasks by Status · Tasks by Employee · Overdue Tasks by Client · Client Health Distribution · Employee Workload.

---

## 9. Automation & triggers

[`automation/Triggers.gs`](../legacy/apps-script/automation/Triggers.gs)

| Trigger | Schedule | Action |
|---|---|---|
| `onOpen` | spreadsheet open | Build custom menu |
| `onEditHandler` | on edit | Route `TASKS.Status` edits, dashboard filter changes |
| `dailyRecalculation` | daily 02:00 | Recalc all progress + health, re-render Control Center + Team Dashboard |
| `runMonthlyTaskGeneration` | monthly, day 1, 03:00 | Generate the period's recurring tasks |
| `generateMonthlyManagementReport` | monthly, day 1, 04:00 | Build management report |

`handleTaskStatusEdit` enforces the state machine on manual edits: an invalid transition is **reverted in place** with a toast. The daily pass is a safety net for state that changes with no edit at all — e.g. a task silently becoming overdue as the date rolls over. **CoreWorks needs an equivalent scheduled job**; overdue-ness is time-dependent, not event-dependent.

---

## 10. Permissions — as they actually exist

[`webapp/WebAppEntry.gs:150-273`](../legacy/apps-script/webapp/WebAppEntry.gs)

The **entire** access model:

```
1. email = Session.getActiveUser().getEmail()   (lowercased, trimmed)
2. Find an EMPLOYEES row where Email matches AND Active? = 'Yes'
3. Found → full access.  Not found → AccessDenied.html
4. On any exception → fail closed (deny)
```

**There is no authorization layer.** Findings:

- **No roles.** `EMPLOYEES.Role` holds job titles (`Bookkeeper`, `Senior Accountant`, `FP&A Analyst`, `Account Manager`, `CFO Advisor`) used **only** for template assignee resolution (§6.10). It is never consulted for access.
- **No per-record scoping.** Any active employee sees every client, task, issue, and request.
- **No tenancy.** One spreadsheet = one implicit organization.
- Coarse protection only: computed columns and `ACTIVITY_LOG` are sheet-protected against manual edit ([`ProtectionUtils.gs`](../legacy/apps-script/utils/ProtectionUtils.gs)); least-privilege is a *documented sharing convention*, not enforcement.

The legacy authors knew: `architecture.md` §10 states *"Full role-based access control is deferred to the future web application."*

**Conclusion: CoreWorks RBAC (Owner/Admin/Manager/Accountant/Team Member/Viewer) is net-new construction, not a migration.** The only inheritable signal is `EMPLOYEES.Role` + `Active?`, usable to seed initial role assignments. [`docs/future-architecture.md`](../legacy/docs/future-architecture.md) proposes Admin / Account Manager / Staff / Client — which CoreWorks' 6-role model supersedes.

---

## 11. Test baseline

`node --test` in `/legacy`: **111 tests, 110 pass, 1 fail.**

| Suite | Covers |
|---|---|
| `healthLogic.test.js` | Health rule set, all branches |
| `progressLogic.test.js` | Simple/weighted completion, next deadline |
| `dateLogic.test.js` | Days remaining/overdue/waiting, buckets, frequency, due dates |
| `taskLogic.test.js` | State machine, validation |
| `idLogic.test.js` | Sequential ID generation |
| `workloadLogic.test.js` | Overload, incl. capacity-0 edge case |
| `controlCenterViewModel.test.js` | KPIs, health rows, surfaced issues, sort rank |
| `clientsViewModel.test.js` | List + detail view models |
| `webappTemplates.test.js` | Apps Script HTML templates ← **the failure** |

**All 110 business-logic assertions pass.** These are the behavioral contract CoreWorks must satisfy; §14 ports them to Vitest as the parity harness.

---

## 12. Defects & discrepancies found

### D1 — Web App never receives the authenticated user *(real bug)*
[`WebAppEntry.gs:68-77`](../legacy/apps-script/webapp/WebAppEntry.gs) assigns `template.currentUserName` / `currentUserEmail`, but [`Index.html:445`](../legacy/apps-script/webapp/Index.html) hardcodes:
```js
var CURRENT_USER = { name: '', email: '' };
```
The identity never reaches client-side JS; only the server-rendered `<?= currentUserName ?>` at line 398 displays it. `webappTemplates.test.js:68` asserts the injection and **fails** — the test is correct, the template is wrong.
**Impact:** cosmetic/latent in legacy. **Action: do not reproduce.** CoreWorks derives identity from the Auth.js session.

### D2 — `architecture.md` §7 misstates the Delayed threshold *(documentation defect)*
The doc says Delayed when *"overdue task count ≥ `HEALTH_DELAYED_OVERDUE_COUNT`"* (= **1**). If true, any single overdue task would mean Delayed, making the At Risk branch (also ≥1 overdue) unreachable.
The **code** ([`HealthLogic.gs:23`](../legacy/apps-script/clients/HealthLogic.gs)) uses `thresholds.delayedTotalOverdueCount`, mapped from `HEALTH_DELAYED_TOTAL_OVERDUE_COUNT` = **3**.
**`HEALTH_DELAYED_OVERDUE_COUNT` is vestigial and unused in logic.** **Action:** the code is authoritative — Delayed at **≥3** overdue, At Risk at **≥1**. Do not migrate the dead constant.

### D3 — Sequential ID generation is not concurrency-safe
`nextSequentialId` scans for max and adds 1. Safe under Apps Script's single-threaded execution; **a duplicate-ID race** under a concurrent web backend. **Action:** replace mechanism with a DB sequence, preserve the format (§4).

### D4 — Name-based foreign keys
`ACTIVITY_LOG.Client`, `MONTHLY_CLOSE.Client`, and all employee references join by **name**. Renaming a client or employee silently orphans history. **Action:** normalize to FK; retain the name as a denormalized display column where useful.

### D5 — Four zero-byte junk files
`apps-script/{0,cd,clasp,type}`. Preserved for mirror fidelity, **not migrated**.

---

## 13. Conflicts between legacy code and the CoreWorks master prompt

Per rules 5/7/12, these are escalated rather than silently resolved. **In every case the legacy code is treated as authoritative**, since the prompt itself designates the existing system as the source of truth.

| # | Master prompt | Legacy reality | Resolution |
|---|---|---|---|
| **C1** | §12 lists 6 task statuses, omitting **In Review** | 7 statuses incl. `In Review`, with transitions into and out of it | **Keep `In Review`.** Rule 12 forbids removing statuses. |
| **C2** | §10 client fields omit **Start Date, Accounting System, Reporting Frequency, Month-End Closing Date** | All four exist; `Start Date` is a **required** field for client creation | **Keep all four.** |
| **C3** | §14 lists issue fields incl. `Description` / `Resolution` | Legacy has **`Impact`** and **`Resolution Date`**, no `Description`/`Resolution` free-text | Keep legacy columns; **add** `Description`/`Resolution` as new optional fields. |
| **C4** | §15 request fields incl. `Description` / `Resolution` | Legacy has `Notes` + `Received Date` | Keep legacy; map `Notes`→description, add `Resolution` as new. |
| **C5** | §17 health table: no filter stated | Filtered to **Active clients only** | **Preserve the filter**; expose it as a toggle rather than changing the default. |
| **C6** | §11 health states "calculated per existing rules" | Thresholds are **SETTINGS-configurable**, not constants | Model as **per-organization settings**, seeded with legacy defaults (3 / 1 / 3 days). |
| **C7** | §9 roles: Owner/Admin/Manager/Accountant/Team Member/Viewer | **No RBAC exists** | Net-new. Seed from `EMPLOYEES.Role`. Documented as new in §10. |
| **C8** | §16 "preserve existing spreadsheet KPI logic" | **Two** KPI sets exist (9 sheet vs 14 web app) | Migrate the **14-KPI Web App set** — it matches §16 exactly. |

---

## 14. Migration map

### 14.1 Pure logic → CoreWorks services *(port near-verbatim)*

| Legacy | CoreWorks target | Fidelity |
|---|---|---|
| `HealthLogic.gs::computeClientHealth` | `src/server/services/health/computeClientHealth.ts` | **Verbatim** |
| `ProgressLogic.gs::computeSimpleCompletion` | `src/server/services/progress/` | **Verbatim** |
| `ProgressLogic.gs::computeWeightedCompletion` | `src/server/services/progress/` | **Verbatim** |
| `ProgressLogic.gs::computeNextDeadline` | `src/server/services/progress/` | **Verbatim** |
| `TaskLogic.gs::TASK_STATUS_TRANSITIONS` | `src/lib/domain/taskStatusMachine.ts` | **Verbatim** |
| `TaskLogic.gs::isTaskOpen` / `nextStatusAllowed` | `src/lib/domain/task.ts` | **Verbatim** |
| `DateLogic.gs::computeDaysRemaining` | `src/lib/domain/date.ts` | **Verbatim** |
| `DateLogic.gs::computeDaysOverdue` | `src/lib/domain/date.ts` | **Verbatim** |
| `DateLogic.gs::computeDaysWaiting` | `src/lib/domain/date.ts` | **Verbatim** |
| `DateLogic.gs::bucketDaysWaiting` | `src/lib/domain/date.ts` | **Verbatim** |
| `DateLogic.gs::frequencyHitsPeriod` | `src/lib/domain/recurrence.ts` | **Verbatim** |
| `DateLogic.gs::computeTaskDueDate` | `src/lib/domain/recurrence.ts` | **Verbatim** |
| `IssueLogic.gs::selectSurfacedIssues` | `src/server/services/issues/surfacing.ts` | **Verbatim** |
| `ClientRequestLogic.gs::flagStaleRequests` | `src/server/services/requests/` | **Verbatim** |
| `WorkloadLogic.gs::isOverloaded` | `src/lib/domain/workload.ts` | **Verbatim** |
| `ClientLogic.gs::resolveDefaultAssignee` | `src/server/services/clients/` | **Verbatim** |
| `TemplateExpansionLogic.gs::expandTemplateToTask` | `src/server/services/templates/` | **Verbatim** |
| `TemplateExpansionLogic.gs::taskDedupeKey` | `src/server/services/templates/` | **Verbatim** |
| `ControlCenterViewModelLogic.gs::buildControlCenterKpis` | `src/server/services/dashboard/controlCenter.ts` | **Verbatim (14-KPI variant)** |
| `ControlCenterViewModelLogic.gs::buildClientHealthRows` | `src/server/services/dashboard/controlCenter.ts` | **Verbatim** |
| `ControlCenterViewModelLogic.gs::healthSortRank` | `src/lib/domain/health.ts` | **Verbatim — keep `hasOwnProperty` semantics** |
| `ClientsViewModelLogic.gs::buildClientDetailViewModel` | `src/server/services/clients/detail.ts` | **Verbatim** |
| `ManagementReportLogic.gs::buildManagementReport` | `src/server/services/reports/` | **Verbatim** |
| `IdLogic.gs::nextSequentialId` | `src/server/services/ids.ts` | **Format preserved, mechanism replaced** (D3) |

### 14.2 I/O wrappers → repositories *(rewritten)*

| Legacy | CoreWorks |
|---|---|
| `SheetUtils.gs::getAllRows` | Prisma queries, **always org-scoped** |
| `SheetUtils.gs::appendRow` / `updateRowById` | Prisma `create` / `update` |
| `SheetUtils.gs::getSetting` | `OrganizationSetting` lookup with defaults |
| `ClientService.gs::createNewClient` | `clientService.create()` server action |
| `TaskService.gs::createTask` / `updateTaskStatus` | `taskService.*` |
| `HealthEngine.gs::recalculateClientHealth` | `healthService.recalculate(clientId)` |
| `ProgressEngine.gs::recalculateClientProgress` | `progressService.recalculate(clientId)` |
| `TaskGeneration{Monthly,Onboarding}.gs` | `taskGenerationService.*` |
| `ActivityLogger.gs::logActivity` | `activityService.log()` |
| `Triggers.gs::dailyRecalculation` | Scheduled job (cron route) |
| `*SheetBuilder.gs` (all) | **Dropped** — replaced by React components |
| `webapp/*.html` | **Dropped** — replaced by Next.js |
| `Menu.gs`, `NavigationUtils.gs`, `ProtectionUtils.gs` | **Dropped** — replaced by nav + RBAC |

### 14.3 Sheets → tables

| Sheet | Table | Normalization |
|---|---|---|
| CLIENTS | `Client` | Contacts → `ClientContact`; FK to `ServicePackage`, `User` |
| EMPLOYEES | `User` + `OrganizationMember` | Split identity from membership; `Role` → job title, RBAC role separate |
| SERVICES | `Service` | — |
| SERVICE_PACKAGES | `ServicePackage` | `Included Service Areas` free-text → `ServicePackageService` join |
| TASK_TEMPLATES | `TaskTemplate` | — |
| TASKS | `Task` | FK to Client/User; add `taskTemplateId` (D4) |
| CLIENT_REQUESTS | `ClientRequest` | Days Waiting derived, not stored |
| ISSUES | `Issue` | — |
| ACTIVITY_LOG | `ActivityLog` | FK by ID, not name (D4) |
| MONTHLY_CLOSE | `MonthlyClose` + `MonthlyCloseTask` | **18 stage columns → 18 rows** |
| SETTINGS | `OrganizationSetting` | Per-org |
| — | `Organization`, `Role`, `Permission`, `Notification`, `Comment`, `Attachment`, `AuditLog`, `ThemeSettings` | **Net-new** |

### 14.4 Test migration
All 110 passing legacy assertions port to Vitest as the **parity harness**, run against the TypeScript ports before any UI work. A port is accepted only when its legacy test passes unchanged in behavior.

---

## 15. Net-new — no legacy equivalent

Explicitly *not* migrations. Built from the master prompt:

Multi-tenancy · Authentication (Auth.js) · RBAC + server-side permission checks · Organization branding/theming/design tokens · Dark mode · Notifications · Global search · Comments · Attachments · CSV import/export · Password reset · Client archive (soft delete) · Bulk task operations · Responsive/mobile · Accessibility · Rate limiting · `AuditLog` distinct from `ActivityLog`

---

## 16. Recommended target stack

Confirms the master prompt §5 and the legacy `future-architecture.md`:

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15** (App Router) + TypeScript | Server Actions give the UI→Service→Repository seam natively |
| UI | **Tailwind CSS + shadcn/ui** | CSS-variable theming is a prerequisite for §27 branding |
| DB | **PostgreSQL** | Per prompt + legacy plan |
| ORM | **Prisma** | Typed client, migrations |
| Auth | **Auth.js v5** | Credentials + session; org membership in JWT |
| Validation | **Zod** | Shared client/server schemas |
| Forms | **React Hook Form + Zod** | — |
| Charts | **Recharts** | §57 |
| Icons | **Lucide** | — |
| Tests | **Vitest** | Direct port target for the legacy Node tests |
| Hosting | **Vercel + Supabase** | Free tier (§54) |

**Tenant isolation strategy:** every business table carries `organizationId`; all access goes through org-scoped repository helpers that require an org context — never raw Prisma calls from route handlers. Enforced server-side (§6 of the prompt), with Postgres RLS as defense-in-depth in a later phase.

---

## 17. Phase plan

Phase 0 is complete. Sequencing follows the master prompt §62, with dependencies from this audit.

| Phase | Scope | Audit dependency |
|---|---|---|
| **0** ✅ | Repository audit, legacy preservation | — |
| **1** | Scaffold, Prisma schema, migrations, Auth.js, design tokens | §3, §5, §14.3 |
| **2** | Organization, users, roles, permissions, tenant isolation | §10, §15 |
| **3** | **Domain logic port + parity tests** ← *before UI* | §6, §11, §14.1 |
| **4** | Clients CRUD + detail | §6.9, §6.10 |
| **5** | Tasks CRUD + state machine | §6.3 |
| **6** | Issues + Requests | §6.5, §6.8 |
| **7** | Control Center (14 KPIs) | §8.2, §8.3 |
| **8** | Client Dashboard | §8.4 |
| **9** | Team Dashboard + Management Report | §8.5, §8.6 |
| **10** | Monthly Close + Templates + generation jobs | §6.11–6.13, §9 |
| **11** | Activity Log + Notifications | §6.14 |
| **12** | Theme/branding | §15 |
| **13** | Import/Export (CSV, Sheets migration path) | §14.3 |
| **14** | Testing, security, deployment | §11 |

> **Phase 3 is deliberately promoted ahead of UI work.** The business rules are the asset being migrated; they must be ported and proven at parity against the legacy test suite before any screen depends on them.

---

## Appendix — audit provenance

| | |
|---|---|
| Legacy commit | `bf74f0b29398af6e67f23b2061b182b81d29da12` (`main`) |
| Files preserved | 98 (verified against git index, zero drift) |
| LOC audited | 7,852 |
| Logic files read in full | 24 |
| Tests executed | 111 (110 pass) |
| Audit date | 2026-08-15 |
