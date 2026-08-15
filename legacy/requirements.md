# Requirements — Finance Lab Client Delivery Management System (V1)

Traceability checklist derived from the original master build prompt. Each phase maps to concrete deliverables in this repo. Checkboxes are updated as stages complete.

## Company context

Finance Lab is a financial services and consulting company offering: Bookkeeping, General Ledger, Accounts Payable, Accounts Receivable, Bank Reconciliation, Inventory, Fixed Assets, Payroll, Month-End Closing, P&L, Balance Sheet, Cash Flow, Budgeting, Sales Forecasting, Cash Forecasting, Budget vs Actual, Variance Analysis, KPI Reporting, Management Reporting, Financial Planning & Analysis, Investment Analysis, Financial Modeling, Business Planning, Profitability Analysis.

## Primary objective

Give Finance Lab management an internal system to instantly answer: client status, task completion/pending/overdue, what's awaited from clients, task ownership, per-client progress, client health (On Track / At Risk / Delayed), what needs management attention, employee workload, and what's due today/this week/this month.

## Phase checklist

- [x] **Phase 0** — Project structure: `apps-script/{config,clients,tasks,templates,dashboards,automation,requests,issues,utils}`, `docs/`, `tests/`, root docs. Modular Apps Script, no monolithic file.
- [x] **Phase 1** — `architecture.md`: entities, relationships, IDs, statuses, priorities, calculated fields, automation logic.
- [x] **Phase 2** — Google Sheets database: CONTROL_CENTER, CLIENTS, EMPLOYEES, SERVICES, SERVICE_PACKAGES, TASK_TEMPLATES, TASKS, CLIENT_REQUESTS, ISSUES, ACTIVITY_LOG, MONTHLY_CLOSE, SETTINGS.
- [x] **Phase 3** — Data validation dropdowns (Task Status, Priority, Client Health, etc.), protected formula cells.
- [x] **Phase 4** — Task management engine: assignment, priority, due dates, completion %, status, review, dependency, recurrence, Days Remaining / Days Overdue auto-calc.
- [x] **Phase 5** — Task Templates: Basic Accounting, Full Finance, CFO/FP&A catalogs.
- [x] **Phase 6** — `createNewClient()` onboarding automation, no duplicate tasks.
- [x] **Phase 7** — `generateMonthlyTasks()` recurring automation, historical tasks preserved, no duplicates.
- [x] **Phase 8** — Progress engine: Simple Completion % and Weighted Completion % (weights Critical=4/High=3/Medium=2/Low=1), both displayed.
- [x] **Phase 9** — Client health engine: On Track 🟢 / At Risk 🟡 / Delayed 🔴 / On Hold ⚪, thresholds editable in SETTINGS.
- [x] **Phase 10** — CONTROL_CENTER dashboard: KPI cards, client health table, 6 charts.
- [x] **Phase 11** — Client Dashboard: dropdown-driven, full client view.
- [x] **Phase 12** — Team Dashboard: per-employee workload and completion.
- [x] **Phase 13** — Monthly Close Dashboard: client/month filters, visual closing stages.
- [x] **Phase 14** — Client Request management: Days Waiting buckets (0-3/4-7/8-14/15+), 15+ flagged.
- [x] **Phase 15** — Issues management: Critical/High/overdue/unresolved surfaced on Control Center.
- [x] **Phase 16** — Activity log: major actions logged, trivial recalculations skipped.
- [x] **Phase 17** — Monthly management report: client performance, team performance, operational risks, attention items.
- [x] **Phase 18** — Navigation: menu + in-sheet links across all major sections.
- [x] **Phase 19** — Sample data: 5+ clients, 5+ employees, 50+ tasks, 15+ requests, 10+ issues (fictional).
- [x] **Phase 20** — `docs/testing.md`: manual + automated test plan, edge cases.
- [x] **Phase 21** — Security: no hardcoded secrets, config/logic separation, least-privilege notes. (Addressed in `architecture.md` §10, Stage 1.)
- [x] **Phase 22** — Documentation: `README.md`, `docs/user-guide.md`, `docs/admin-guide.md`.
- [x] **Phase 23** — `docs/future-architecture.md`: path to a web application (design only).

## Confirmed deviations from literal spec

1. **CLIENTS** — the single spec'd `Overall Progress` column is replaced by two columns, `Simple Completion %` and `Weighted Completion %`, per Phase 8's requirement that both be displayed. Confirmed with stakeholder.
2. **CLIENT_REQUESTS** — a persisted, formula-driven `Days Waiting Bucket` column (`0-3` / `4-7` / `8-14` / `15+`) is added beyond the literal spec'd columns, so dashboards can `COUNTIF` it directly and the raw sheet is sortable by bucket. Confirmed with stakeholder.

## Acceptance criteria

The system is complete only if a manager can open it and immediately answer: active client count, which clients are delayed, each client's progress, overdue tasks, what's awaited from clients, task ownership, each employee's workload, what's due this week, what completed this month, which issues need attention, and month-end close status per client.
