# Changelog

All notable changes to the Finance Lab Client Delivery Management System are recorded here, grouped by build stage.

## [1.0.0] — Initial V1 build

All 23 phases of the original spec implemented across 9 build stages. See `requirements.md` for the full phase checklist and confirmed deviations.

### Stage 1 — Foundation, Architecture, Central Schema
- Initial project structure created (`apps-script/`, `docs/`, `tests/`).
- `architecture.md`, `requirements.md`, `README.md` (stub) added.
- Central config modules added: `SheetNames.gs`, `Enums.gs`, `Schemas.gs`, `Constants.gs`.
- Shared utilities added: `SheetUtils.gs`, `IdLogic.gs` / `IdService.gs`, `DateLogic.gs`.

### Stage 2 — Spreadsheet Setup Engine
- `setupSpreadsheet()` orchestrator and one idempotent `build<Sheet>Sheet()` per sheet (11 data sheets + 4 dashboard-layout frames).
- `ProtectionUtils.gs`, `ValidationUtils.gs`, `FormattingUtils.gs`.
- Live `ARRAYFORMULA` date-math columns on TASKS and CLIENT_REQUESTS; MONTHLY_CLOSE's Completion %/Close Status formulas.
- SERVICES and SERVICE_PACKAGES seeded with Finance Lab's real catalog content.

### Stage 3 — Task Engine Core + Template Content
- `TaskLogic.gs` (status state machine, validation) / `TaskService.gs` (the single task-creation/transition path).
- Basic Accounting / Full Finance / CFO-FP&A template catalog (`TaskTemplatesData.gs`, 47 rows) seeded by `TaskTemplateService.gs`.
- `TemplateExpansionLogic.gs` — the one function that turns a template + client into task fields.

### Stage 4 — Onboarding, Monthly Generation, Progress Engine
- `createNewClient()`, `generateOnboardingTasks()`, `generateMonthlyTasks()` (all duplicate-safe, history-preserving).
- `computeTaskDueDate()` due-date rule (Month-End Closing due the following month; everything else at period-end + typical duration).
- Progress engine writing CLIENTS' Simple/Weighted Completion % and Next Deadline.

### Stage 5 — Client Health, Request Automation, Issue Surfacing
- `HealthLogic.gs`/`HealthEngine.gs` (On Track/At Risk/Delayed/On Hold, SETTINGS-driven thresholds).
- `ClientRequestLogic.gs`/`Service.gs` (stale-request flagging, top-clients-by-outstanding).
- `IssueLogic.gs`/`Service.gs` (Critical/High/overdue surfacing).
- Fixed an overly-aggressive "At Risk" trigger (scoped due-soon check to Critical/High tasks only) and a too-tight onboarding due-date rule found during integration testing.

### Stage 6 — Dashboards
- Control Center: 9 live-formula KPI cards, script-computed Client Health/Issues tables, 6 charts bound to a new hidden `_CHART_SRC` pivot sheet.
- Client Dashboard, Team Dashboard (with workload overload flag), Monthly Close Dashboard engines.

### Stage 7 — Activity Log, Navigation, Management Report
- `ActivityLogger.gs` (the single ACTIVITY_LOG append path, also stamping CLIENTS.Last Activity).
- `Triggers.gs` (onOpen, onEdit with status-transition validation, daily/monthly time-driven triggers), `Menu.gs`, `NavigationUtils.gs`.
- `ManagementReportLogic.gs`/`Engine.gs` (client/team performance, operational risks, management attention).

### Stage 8 — Sample Data + Node Unit Tests
- `seedSampleData()`: 5 employees, 5 clients across all packages/statuses, 100+ tasks (via real onboarding + monthly generation), 15 client requests, 12 issues — idempotent.
- `tests/helpers/loadGas.js` + 65 Node unit tests across 6 pure-logic modules, all passing (`npm test`).

### Stage 9 — Documentation and Future Architecture
- `docs/testing.md` (manual test plan covering client/task/automation/dashboard tests and 8 edge cases), `README.md` (finalized: install, architecture, how-tos, troubleshooting), `docs/user-guide.md` (for staff), `docs/admin-guide.md` (for management/admins), `docs/future-architecture.md` (path to a web application, design only).
