# Finance Lab — Client Delivery Management System (V1)

Internal Client Delivery Operations System for Finance Lab, built on Google Sheets + Google Apps Script. Answers, at a glance: which clients are on track / at risk / delayed, what tasks are overdue, what's awaited from clients, who owns what, employee workload, and month-end close status — across every Finance Lab client.

See `requirements.md` for the phase-by-phase spec checklist, `architecture.md` for the system design, `docs/testing.md` for the test plan, `docs/webapp-guide.md` for the browser UI layer built on top of this backend, and `docs/future-architecture.md` for the longer-term (separately-hosted) web application path.

## Project layout

```
apps-script/   Modular Google Apps Script source
  config/        SheetNames, Enums, Schemas, Constants, Setup.gs (setupSpreadsheet), SettingsSheetBuilder
  clients/       Client + Employee sheet builders, ClientLogic/Service, HealthLogic/Engine
  tasks/         Tasks + Monthly Close sheet builders, TaskLogic/Service, ProgressLogic/Engine,
                 onboarding/monthly generation, WorkloadLogic
  templates/     Services + Service Packages + Task Templates sheet builders, template catalog
                 content, TemplateExpansionLogic, TaskTemplateService
  dashboards/    Control Center, Client, Team, Monthly Close dashboards + charts + management report
  automation/    ActivityLogger, Triggers, Menu, sample data seeding
  requests/      Client Requests sheet builder, ClientRequestLogic/Service
  issues/        Issues sheet builder, IssueLogic/Service
  utils/         SheetUtils, IdLogic/Service, DateLogic, Protection/Validation/FormattingUtils
docs/          user-guide.md, admin-guide.md, testing.md, future-architecture.md
tests/         Node-runnable unit tests for the pure *Logic.gs modules (npm test)
architecture.md, requirements.md, changelog.md
```

Every file that touches `SpreadsheetApp` is paired with a pure `*Logic.gs` counterpart with no Apps Script dependency — see `architecture.md` §8. That split is both how the Node tests work and the seam a future backend will lift out (`docs/future-architecture.md`).

## Installation

This system was built entirely as local files (no live Google Sheet was available during development — see `docs/testing.md` for what that means for verification). You'll deploy it yourself:

1. **Install `clasp`** (Google's Apps Script CLI), if you don't have it: `npm install -g @google/clasp`, then `clasp login`.
2. **Create the Apps Script project.** Either:
   - Create a new Google Sheet, open **Extensions → Apps Script**, and note the Script ID (Project Settings), then run `clasp clone <scriptId>` locally and copy this repo's `apps-script/*` files into the cloned project, **or**
   - From this repo, run `clasp create --type sheets --title "Finance Lab Client Delivery"` (creates both the Sheet and the bound script), then `clasp push`.
3. **Push the code**: `clasp push` from the `apps-script/` directory (or repo root with an `appsscript.json`/`.clasp.json` pointing at `apps-script/` as the root — configure `rootDir` in `.clasp.json` to `"apps-script"`).
4. **Authorize the script.** Open the Sheet, refresh, open **Extensions → Apps Script**, select `setupSpreadsheet` from the function dropdown, and click Run. The first run prompts for OAuth authorization (Sheets, and Apps Script's trigger-management scope) — approve it.
5. **Run `setupSpreadsheet()`.** This builds every sheet, formula, dropdown, protection rule, chart, trigger, and nav link, and generates an initial (empty) management report. It's safe to re-run any time — see "Troubleshooting" below.
6. **Reload the Sheet.** The **Finance Lab** menu appears (built by `onOpen()`).
7. **(Optional) Load sample data.** From the Apps Script editor, run `seedSampleData()` to populate 5 fictional clients, 5 employees, 100+ tasks, 15 requests, and 12 issues — useful for a demo or for exploring the dashboards before real client data exists. It's idempotent (safe to run once; running it again is a no-op).

## How to add a client

Run `createNewClient({...})` from the Apps Script editor with a fields object — required fields are Client Name, Service Package, Account Manager, and Start Date (see `apps-script/clients/ClientLogic.gs::validateClientFields`). It validates the input, generates the Client ID (never hand-write one), generates onboarding tasks from the client's Service Package templates, and logs the activity, all in one call. A menu-driven "New Client" form is a natural V2 addition instead of running a function from the editor each time — see `docs/future-architecture.md`.

## How to assign services

A client's services come from its **Service Package** (CLIENTS column), not assigned service-by-service. Change a client's package by editing that cell (validated against SERVICE_PACKAGES). The next `generateMonthlyTasks()` run picks up the new package's templates going forward — past tasks aren't retroactively changed.

## How to generate tasks

- **Onboarding tasks** generate automatically inside `createNewClient()`.
- **Recurring monthly tasks** generate via `generateMonthlyTasks()` — either automatically (a monthly time-driven trigger, installed by `setupSpreadsheet()`) or manually via **Finance Lab → Run: Generate Monthly Tasks**. Both are safe to re-run: already-generated (Client, Service Area, Task Name, Period) combinations are skipped, and past periods are never touched.

## How to update tasks

Change a task's Status directly in TASKS — an `onEdit` trigger validates the transition (see `apps-script/tasks/TaskLogic.gs`'s state machine), stamps Last Updated, and recalculates that client's progress and health automatically. An invalid transition (e.g. jumping a "Not Started" task straight to "Completed") is reverted with an explanatory toast.

## How to manage employees

Add/edit rows directly in EMPLOYEES. `Role` matters: it's what `TASK_TEMPLATES.Default Assignee` (a role, not a person) resolves against when tasks are generated — see `apps-script/clients/ClientLogic.gs::resolveDefaultAssignee`. `Capacity` drives the Team Dashboard's overload flag.

## How monthly tasks work

See `architecture.md` §7. In short: for every client with Contract Status = "Active", every active template whose Frequency "hits" the target period expands into a task, unless that exact (Client, Service Area, Task Name, Period) combination already exists. Month-End Closing tasks are due on the 5th of the following month by default (editable in SETTINGS); everything else is due at period-end plus its template's typical duration.

## How dashboards work

- **Control Center** — KPI cards are live formulas; the Client Health and Issues tables and the 6 charts are script-computed/rendered (`renderControlCenter()`, `buildControlCenterCharts()`), refreshed daily and via **Finance Lab → Run: Rebuild Dashboards**.
- **Client Dashboard** — pick a client from the dropdown at the top; an `onEdit` trigger re-renders the whole sheet for that client.
- **Team Dashboard** and **Monthly Close Dashboard** — refreshed the same way (daily trigger + the Rebuild Dashboards menu item; Monthly Close also re-renders when you change its Client/Month filter cells).

## How to modify templates

Edit TASK_TEMPLATES directly (it's a normal sheet — add, edit, or deactivate rows via the `Active?` column) or edit the seed content in `apps-script/templates/TaskTemplatesData.gs` and re-run `seedTaskTemplates()` (only appends templates not already present by Service Package + Task Name — won't touch ones you've since customized in the sheet).

## How to change settings

Edit SETTINGS directly. The "Parameters" block (columns A-D) holds thresholds like `HEALTH_AT_RISK_OVERDUE_COUNT`; the "Enumerated Lists" block (columns G onward) holds each dropdown's values — add a row under an existing list to extend it. See `docs/admin-guide.md` for which values are safe to rename and which are code-significant.

## Troubleshooting

- **`#REF!` or blank formulas after adding a lot of data.** `MAX_DATA_ROWS` (2000 by default, `apps-script/config/Constants.gs` and mirrored in SETTINGS) bounds every `ARRAYFORMULA`/`QUERY` range. Raise it in both places and re-run `setupSpreadsheet()`.
- **Authorization prompt on every run.** Normal for the first run after each redeploy that changes requested scopes; approve once and it won't reprompt until scopes change again.
- **A manual TASKS.Status edit got reverted.** That's the `onEdit` trigger protecting the state machine — see the toast message for which transition was rejected, and `apps-script/tasks/TaskLogic.gs` for the allowed set.
- **Re-running `setupSpreadsheet()` seems to have done nothing new.** That's by design — it's idempotent. Check `changelog.md`/git history for what actually changed in the code since your last run.
- **Duplicate-looking tasks after generation.** Shouldn't happen — generation keys on (Client, Service Area, Task Name, Period). If you see it, check whether the Task Name was edited on one row after generation (dedup keys off the *template's* name at generation time, not a live join).
