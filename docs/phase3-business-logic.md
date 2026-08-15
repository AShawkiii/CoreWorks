# Phase 3 — Business Logic Migration & Parity

**Status:** Complete
**Source of truth:** the preserved legacy system in [`/legacy`](../legacy), audited in [`architecture-audit.md`](./architecture-audit.md)
**Method:** differential parity — the real legacy Apps Script functions are loaded into the test process and run against the same fixtures as the TypeScript ports, then compared.

---

## 1. What "parity" means here

Re-typing legacy's expected outputs into new tests would only prove that the
port matches *my reading* of the legacy code. Instead,
[`tests/parity/legacy-context.ts`](../tests/parity/legacy-context.ts) loads the
untouched `.gs` files into a Node `vm` context — the same mechanism the legacy
test suite uses, mirroring how Apps Script merges every file into one global
namespace — and the tests call **both implementations**:

```
fixture ──┬─► toLegacy*()  ─► legacy .gs function  ─┐
          │                                          ├─► compared
          └─► domain record ─► TypeScript port      ─┘
```

Both sides are projected from one fixture, so a divergence can only mean the
logic differs — never that the two inputs drifted.

**1,670 differential assertions** across 6 parity files. Where a legacy rule
existed only as a spreadsheet formula (monthly close) or inside a sheet-writing
engine (client/team dashboards), there is no legacy JavaScript to diff against;
those are covered by direct unit tests asserting the formula semantics case by
case, and are marked accordingly below.

---

## 2. Migration map

### 2.1 Pure rules — ported with differential parity

| Legacy source | Function | CoreWorks destination | Parity | Tests |
|---|---|---|---|---|
| `utils/DateLogic.gs` | `toDateOnly`, `daysBetween` | `src/lib/domain/date.ts` | ✅ differential | `date.parity` |
| " | `computeDaysRemaining` | " | ✅ differential | 28 cases (7 statuses × 4 dates) |
| " | `computeDaysOverdue` | " | ✅ differential | 49 cases incl. 0/1/2/≥3 boundary |
| " | `computeDaysWaiting` | " | ✅ differential | 30 cases (5 statuses × 3 × 2) |
| " | `bucketDaysWaiting` | " | ✅ differential | 11 boundary values |
| " | `frequencyHitsPeriod` | " | ✅ differential | 84 cases (6 × 7 × 2) |
| " | `computeTaskDueDate` | " | ✅ differential | 60 cases + leap year + year rollover |
| " | `formatPeriod` | " | ✅ differential | 4 cases |
| `tasks/TaskLogic.gs` | `TASK_STATUS_TRANSITIONS` | `src/lib/domain/task.ts` | ✅ differential | full 7×7 matrix |
| " | `isTaskOpen` | " | ✅ differential | all 7 statuses |
| " | `nextStatusAllowed` | " | ✅ differential | 49 transitions |
| " | `validateTaskFields` | " | ✅ port (typed) | see §4 DIFF-2 |
| `tasks/ProgressLogic.gs` | `computeSimpleCompletion` | `src/lib/domain/progress.ts` | ✅ differential | 8 scenarios |
| " | `computeWeightedCompletion` | " | ✅ differential | 8 scenarios |
| " | `computeNextDeadline` | " | ✅ differential | 6 scenarios |
| `clients/HealthLogic.gs` | `computeClientHealth` | `src/lib/domain/health.ts` | ✅ differential | **600 exhaustive cases** |
| `webapp/ControlCenterViewModelLogic.gs` | `healthSortRank` | " | ✅ differential | all 4 + unknown |
| `issues/IssueLogic.gs` | `isIssueOpen` | `src/lib/domain/issue.ts` | ✅ differential | all 4 statuses |
| " | `isUnresolvedCriticalOrHigh` | " | ✅ differential | 16 status×severity |
| " | `isOverdueIssue` | " | ✅ differential | 64 cases |
| " | **`selectSurfacedIssues`** | " | ✅ differential | 7 scenarios incl. ordering |
| `requests/ClientRequestLogic.gs` | `isRequestOpen` | `src/lib/domain/request.ts` | ✅ differential | all 5 statuses |
| " | `flagStaleRequests` | " | ✅ differential | 4 scenarios |
| " | `topClientsByOutstandingRequests` | " | ✅ differential | 2 scenarios |
| `tasks/WorkloadLogic.gs` | `isOverloaded` | `src/lib/domain/workload.ts` | ✅ differential | 40 cases |
| `clients/ClientLogic.gs` | `validateClientFields` | `src/lib/domain/client.ts` | ✅ differential | 6 cases |
| " | `isDuplicateClient` | " | ✅ differential | 5 cases |
| " | `resolveDefaultAssignee` | " | ✅ differential | 10 cases |
| `templates/TemplateExpansionLogic.gs` | `expandTemplateToTask` | `src/lib/domain/template.ts` | ✅ differential | 2 scenarios |
| " | `taskDedupeKey` | " | ✅ differential | 4 cases |
| `templates/TaskTemplatesData.gs` | `buildTaskTemplateSeed` | `src/lib/domain/task-template-catalog.ts` | ✅ differential | tier counts + full name list |
| `utils/IdLogic.gs` | `nextSequentialId` | `src/lib/domain/ids.ts` | ⚠️ format only | see §4 DIFF-3 |

### 2.2 View models — ported with differential parity

| Legacy source | Function | CoreWorks destination | Parity |
|---|---|---|---|
| `webapp/ControlCenterViewModelLogic.gs` | **`buildControlCenterKpis`** (14 KPIs) | `src/lib/domain/view-models/control-center.ts` | ✅ differential, 6 scenarios |
| " | **`buildClientHealthRows`** | " | ✅ differential, 6 scenarios |
| " | `buildSurfacedIssueRows` | " | ✅ differential, 6 scenarios |
| " | `buildControlCenterViewModel` | " | ✅ composed |
| " | `groupRowsByClientId` | " | ✅ used by the above |
| `webapp/ClientsViewModelLogic.gs` | `buildClientsListViewModel` | `src/lib/domain/view-models/clients.ts` | ✅ differential |
| " | **`buildClientDetailViewModel`** | " | ✅ differential, 5 assertions |
| " | `buildClientDetailTaskRows` | " | ✅ differential (ordering) |
| " | `buildClientDetailIssueRows` | " | ✅ differential (ordering) |
| " | `buildClientDetailRequestRows` | " | ✅ differential (ordering) |
| " | `issueSeverityRank`, `taskDueDateSortKey` | `issue.ts` / `clients.ts` | ✅ used by the above |
| `dashboards/ManagementReportLogic.gs` | `buildManagementReport` + 4 sections | `src/lib/domain/view-models/management-report.ts` | ✅ differential, all sections |

### 2.3 Rules with no legacy JavaScript counterpart

Legacy expressed these as spreadsheet formulas or inside sheet-writing
engines, so there is nothing to diff against. Each is asserted directly
against the documented formula/engine behaviour.

| Legacy source | Rule | CoreWorks destination | Coverage |
|---|---|---|---|
| `tasks/MonthlyCloseSheetBuilder.gs` (live formula) | Close `Completion %` | `src/lib/domain/monthly-close.ts` | 7 unit cases, incl. 0% / partial / 100% |
| " | Close `Status` (IFS order) | " | 7 unit cases |
| `config/Schemas.gs` | 18 stages + order | " (`buildCloseStages`) | 2 unit cases |
| `dashboards/MonthlyCloseDashboardEngine.gs` | period summary | `view-models/monthly-close-dashboard.ts` | 5 unit cases |
| `dashboards/ClientDashboardEngine.gs` | 7 summary cards | `view-models/client-dashboard.ts` | 3 unit cases |
| " | service-area progress | " | 4 unit cases |
| " | upcoming deadlines | " | 2 unit cases |
| `dashboards/TeamDashboardEngine.gs` | per-member workload row | `view-models/team-dashboard.ts` | 6 unit cases |

### 2.4 I/O engines — rewritten against Prisma

Behaviour preserved; only the storage layer changed.

| Legacy source | CoreWorks destination | Notes |
|---|---|---|
| `clients/HealthEngine.gs` | `src/server/services/health.ts` | Recomputes overdue-ness from raw due date + status, not a stored column — legacy's reason (correct the instant a status changes) still applies |
| `tasks/ProgressEngine.gs` | `src/server/services/progress.ts` | Stores simple %, weighted %, next deadline |
| `tasks/TaskService.gs` | `src/server/services/tasks.ts` | Single create/transition path; `skipLog` preserved |
| `tasks/TaskGenerationOnboarding.gs` | `src/server/services/task-generation.ts` | Same due-date rule as monthly, deliberately |
| `tasks/TaskGenerationMonthly.gs` | " | Active clients only; one summary log per run |
| `templates/TaskTemplateService.gs` | " (`templatesForPackage`) | Scoped by package **id**, not name |
| `utils/SheetUtils.gs::getSetting` | `src/server/services/settings.ts` | SETTINGS live, constants as fallback |
| `automation/ActivityLogger.gs` | `src/server/services/activity.ts` | Ported in Phase 2 |
| `dashboards/ControlCenterEngine.gs` | `src/server/services/dashboard.ts` | Gathers data only; computes nothing |
| `dashboards/TeamDashboardEngine.gs` | " | " |
| `dashboards/ManagementReportEngine.gs` | " | " |
| `*SheetBuilder.gs`, `webapp/*.html`, `Menu.gs`, `NavigationUtils.gs`, `ProtectionUtils.gs` | **dropped** | Replaced by React + RBAC |

---

## 3. The 14 Control Center KPIs

Ported from the Web App view model, key for key, in order. The brief's §16
list matches these exactly (audit §8.2), so the 9-KPI spreadsheet variant was
**not** migrated.

| # | Key | Definition |
|---|---|---|
| 1 | `totalClients` | all clients |
| 2 | `activeClients` | Contract Status = Active |
| 3 | `onboardingClients` | Contract Status = Onboarding |
| 4 | `onHoldClients` | Contract Status = On Hold |
| 5 | `clientsAtRisk` | Health = At Risk |
| 6 | `clientsDelayed` | Health = Delayed |
| 7 | `overallCompletionPct` | **mean of per-client weighted %** |
| 8 | `openTasks` | non-cancelled and open |
| 9 | `overdueTasks` | `computeDaysOverdue(...) > 0` |
| 10 | `tasksCompleted` | Status = Completed |
| 11 | `waitingOnClient` | Status = Waiting Client |
| 12 | `blockedTasks` | Status = Blocked |
| 13 | `openIssues` | `isIssueOpen` |
| 14 | `issuesNeedingAttention` | `selectSurfacedIssues(...).length` |

Two legacy behaviours are preserved that a redesign would likely "fix":

- **Task KPIs (8–12) are unscoped by client contract status.** They count
  across every client, matching the spreadsheet's `COUNTIF` formulas. Scoping
  them to Active clients would make CoreWorks disagree with the system it
  replaces.
- **KPI 7 is a plain mean of percentages, not task-weighted.** A three-task
  client and a three-hundred-task client contribute equally. Audit §8.2 flags
  this for product review; it is preserved rather than silently changed,
  because changing it moves a number management already tracks.

---

## 4. Known differences

Every deviation from legacy, and why.

### DIFF-1 — Monthly close: blank stages *(behaviour preserved, cannot arise)*
Legacy `COUNTA` excludes blank stage cells from the completion denominator, so
a close with one Completed stage and seventeen blanks reads **100% / Closed**.
`computeCloseCompletion` honours that, so imported legacy data behaves as it
did in the sheet. CoreWorks materialises all 18 stages with an explicit status
when a close is created, so the denominator is always 18 and the situation
cannot occur in new data.
*Covered by:* `tests/unit/monthly-close.test.ts` — both the blank and the
all-explicit case are asserted.

### DIFF-2 — `validateTaskFields`: priority/status checks moved to the type system
Legacy checked at runtime that Priority and Status were members of their enum,
because a spreadsheet cell can contain anything. In CoreWorks those are
PostgreSQL enums, validated by Zod at the edge and by the compiler in between,
so the runtime string-membership check is unreachable. The three **required
field** checks (Client ID, Task Name, Service Area) are ported unchanged,
including their exact error strings.
*Impact:* none reachable.

### DIFF-3 — ID generation: mechanism replaced, format preserved *(audit D3)*
Legacy scanned all rows for the highest suffix and added one — safe
single-threaded, a duplicate-ID race under a concurrent backend. Replaced by
an atomic per-organization counter. Format is byte-identical and parity-tested
against `nextSequentialId`.
*Infrastructure correction, not a business-rule change.*

### DIFF-4 — Foreign keys by id, not name *(audit D4)*
Legacy linked activity, monthly close, and assignments by display name, so
renaming a client or employee orphaned history. CoreWorks uses real foreign
keys. Activity entries additionally snapshot `userEmail` so they stay readable
after a user is removed.
*Infrastructure correction, not a business-rule change.*

### DIFF-5 — `null` instead of `''` for absent values
Legacy returned the empty string for "no value" (`computeDaysRemaining`,
`computeDaysWaiting`, `bucketDaysWaiting`, `computeNextDeadline`). The ports
return `null`. Purely representational; the parity harness normalises `''` ↔
`null` and every other aspect of those functions is compared unchanged.

### DIFF-6 — Days Waiting derived, not stored
Legacy read `Days Waiting` from a live spreadsheet column. CoreWorks derives it
per request via the same date rule (master prompt §15), so there is one fewer
place for it to go stale. The rule itself is parity-tested.

### DIFF-7 — Web App identity bug NOT reproduced *(audit D1)*
Legacy `Index.html` hardcoded `CURRENT_USER = {name:'', email:''}` so the
authenticated identity never reached client-side JS. CoreWorks derives identity
from the Auth.js session. Deliberately not carried over.

### Not a difference: Delayed threshold is 3
Legacy `architecture.md` §7 said the Delayed threshold was 1 overdue task,
which would have made the At Risk branch unreachable. `HealthLogic.gs` uses 3.
The **code** is authoritative (audit D2). Pinned by an explicit test and by 600
exhaustive differential cases.

### Not a difference: `In Review` retained
The CoreWorks brief's §12 omitted it; legacy has it with real transitions in
and out (audit conflict C1). Retained, and covered by the full 7×7 transition
matrix.

---

## 5. Test coverage

| Suite | Files | Tests |
|---|---|---|
| Parity (differential vs legacy) | 6 | 1,670 |
| Unit (domain rules with no legacy JS counterpart, plus Phase 1–2 logic) | 10 | 145 |
| Integration (services + PostgreSQL) | 2 | 46 |
| **CoreWorks total** | **18** | **1,861** |
| Legacy suite (unchanged, still passing) | 9 | 111 (110 pass) |

The legacy suite is **untouched**. Its one pre-existing failure
(`webappTemplates.test.js`) is the Apps Script HTML template test documenting
audit defect D1, in code CoreWorks replaces — it is neither fixed nor deleted,
since it correctly records a real legacy bug.

### Boundary cases required by the phase brief

| Case | Where |
|---|---|
| zero records | `progress-task.parity` (no tasks), `view-models.parity` (empty org), `monthly-close` |
| missing values | `date.parity` (null dates), `clients.parity` (null company) |
| overdue = 0 / 1 / 2 / ≥3 | `date.parity` boundary set; `health.parity` exhaustive; `domain-services` walks the DB boundary |
| completed tasks | every completion and health suite |
| cancelled tasks | `progress-task.parity`, `dashboards`, `monthly-close` |
| `In Review` | transition matrix, completion, next deadline, task summary |
| inactive users | `client.parity` (`resolveDefaultAssignee` skips inactive) |
| clients with no tasks | `view-models.parity`, `domain-services` |
| partially completed clients | `progress-task.parity`, `domain-services` |
| close at 0% / partial / 100% | `monthly-close` |
| conflicting/missing dates | `date.parity`, `clients.parity` (no-date sorts last) |
| multiple owners/managers | `permissions`, `members` integration (Owner-peer rule) |

---

## 6. Live verification

Against PostgreSQL 16, signed in as Owner, all 14 KPIs rendered by the running
application were cross-checked against independent SQL:

| KPI | App | SQL |
|---|---|---|
| Total Clients | 10 | 10 |
| Active Clients | 7 | 7 |
| Onboarding | 2 | 2 |
| On Hold | 1 | 1 |
| Clients At Risk | 4 | 4 |
| Clients Delayed | 2 | 2 |
| Overall Completion % | 9% | 9 |
| Open Tasks | 10 | 10 |
| Overdue Tasks | 4 | 4 |
| Tasks Completed | 2 | 2 |
| Waiting on Client | 2 | 2 |
| Blocked Tasks | 1 | 1 |
| Open Issues | 4 | 4 |
| Issues Needing Attention | 3 | 3 |

Ordering was verified in the rendered HTML: the health table showed the 7
Active clients only, Delayed → At Risk → On Track with alphabetical tiebreak;
surfaced issues showed Critical first, then High oldest-first.

The seed now calls the real engines rather than hardcoding derived values, so
demo health (`ON_TRACK=3 AT_RISK=4 DELAYED=2 ON_HOLD=1`) is produced by the
ported rules.

---

## 7. Architecture

The domain layer imports **no** Prisma client, Next.js, Auth.js, or React. It
takes plain domain records (`src/lib/domain/types.ts`) and returns plain
values, which is what makes the parity harness possible at all — the rules run
in a bare Node context alongside the legacy `.gs` files.

```
Route / Server Action        authorize, validate
  → Service                  gather data, persist, log
    → mappers.ts             Prisma row → domain record
      → domain rule          pure, deterministic
```

`src/server/services/mappers.ts` is the only boundary where Prisma types meet
domain types. Its `select` shapes are the contract, enforced by the compiler.

Every service takes an `OrgContext` and scopes each query by
`ctx.organizationId`, which comes from the session. Cross-tenant reads and
writes are covered by integration tests: creating a task against another
organization's client, transitioning another organization's task, and
recalculating another organization's health all fail.

---

## 8. Not in this phase

| Item | Phase |
|---|---|
| Clients / Tasks / Issues / Requests CRUD screens | 4–6 |
| Client Dashboard, Team Dashboard, Management Report **screens** (logic is ported and tested) | 8–9 |
| Monthly Close screens and close generation service | 10 |
| Scheduled daily recalculation and monthly generation jobs (functions exist and are tested; no scheduler yet) | 10 |
| Activity Log UI | 11 |
