# Testing — Finance Lab Client Delivery Management System

Two layers of testing exist:

1. **Automated (Node).** Every pure business-logic module (`*Logic.gs`) has unit tests under `tests/unit/`, runnable with `npm test` — no Google account or live spreadsheet needed. See `tests/README.md`.
2. **Manual (live spreadsheet).** Everything that touches `SpreadsheetApp` — sheet builders, triggers, the menu, dashboards, charts — needs a real deployed spreadsheet. This document is that manual test plan.

Run the manual tests after `clasp push` and `setupSpreadsheet()` (see `README.md` for install steps). Unless noted, "run X" means: open the Apps Script editor, select the function, click Run — or use the **Finance Lab** menu's equivalent "Run:" item where one exists.

## 0. Automated tests

```
npm test
```

Expected: all tests pass (65 at last count). Run this before every manual test pass — a red Node test means a pure-logic bug that will show up everywhere downstream.

## 1. Client tests

| # | Test | Steps | Expected result |
|---|---|---|---|
| 1.1 | Create client | Run `createNewClient({...})` from the editor (or add a row to CLIENTS by hand for a quick manual check) with a new Client Name/Company Name/Service Package/Account Manager/Start Date. | A new CLIENTS row appears with a `CL-####` ID, Contract Status "Onboarding" (if not set), Client Health "On Track", 0% completion. Onboarding tasks appear in TASKS for that client (count matches the package: 9/16/22). An ACTIVITY_LOG row "Client Added" appears. |
| 1.2 | Duplicate client rejected | Call `createNewClient()` again with the same Client Name + Company Name. | Throws an error; no second CLIENTS row is created. |
| 1.3 | Edit client | Change a client's Account Manager or Priority directly in CLIENTS. | Cell updates normally (these columns aren't protected). |
| 1.4 | Assign package | Change a client's Service Package, then run `generateMonthlyTasks()` for a future period. | New tasks generated for that client use the NEW package's templates. |
| 1.5 | Assign employee | Change Account Manager to a different employee, run **Finance Lab → Run: Recalculate All**. | No error; existing tasks keep their original Assigned To (reassignment doesn't retroactively touch past tasks — expected). |
| 1.6 | Change health manually blocked | Try to type directly into a CLIENTS "Client Health" cell. | Sheet protection blocks the edit (warns "you can't edit this cell"), since it's script-computed. |

## 2. Task tests

| # | Test | Steps | Expected result |
|---|---|---|---|
| 2.1 | Create task | Add a row to TASKS by hand, or call `createTask({...})`. | Task ID auto-generated (`TSK-######`), Created Date/Last Updated stamped, Days Remaining/Days Overdue formulas populate. |
| 2.2 | Change status (valid) | On an existing task, change Status from "Not Started" to "In Progress" directly in the sheet. | Accepted; Last Updated stamps; an ACTIVITY_LOG "Task Status Changed" entry appears; that client's CLIENTS progress/health recalculate. |
| 2.3 | Change status (invalid) | Change a "Completed" task's Status directly to "Blocked". | The edit is reverted back to "Completed" and a toast explains why — Completed can only reopen to "In Progress". |
| 2.4 | Complete task | Change a task's Status to "Completed". | Completion Date stamps to today; Completion % sets to 100%; client progress increases. |
| 2.5 | Change assignee | Call `reassignTask(taskId, 'New Employee Name')`. | Assigned To updates; ACTIVITY_LOG "Task Reassigned" entry appears (only if the name actually changed). |
| 2.6 | Change deadline | Edit a task's Due Date to a future date. | Days Remaining recalculates live (no script run needed — it's a formula). |
| 2.7 | Create overdue task | Set a task's Due Date to a past date while Status is open (not Completed/Cancelled). | Days Overdue turns positive and the cell highlights red (conditional formatting); Control Center's "Overdue Tasks" KPI increments. |

## 3. Automation tests

| # | Test | Steps | Expected result |
|---|---|---|---|
| 3.1 | Onboarding generation | Create a new client on "Full Finance". | Exactly 16 tasks generated (9 Basic Accounting + 7 Full Finance additions), due dates on the normal monthly cadence (not "today + a few days"). |
| 3.2 | Monthly generation | Run **Finance Lab → Run: Generate Monthly Tasks**. | Tasks generated for the current period for every Active client, respecting each template's Frequency (Quarterly/Annually templates only fire on their matching months). A toast reports the count. |
| 3.3 | Prevent duplicates | Run monthly generation twice in a row for the same period. | The second run reports 0 tasks created — nothing duplicates. |
| 3.4 | Preserve history | Run monthly generation for next month. | Prior months' tasks are untouched; only new rows for the new period are added. |
| 3.5 | Health recalculation | Manually push 3+ of one client's tasks overdue, then run **Recalculate All**. | That client's Client Health updates to "Delayed". |
| 3.6 | Management report | Run **Finance Lab → Run: Generate Management Report**. | A MANAGEMENT_REPORT sheet (re)builds with client performance, team performance, operational risks, and management-attention sections. |

## 4. Dashboard tests

| # | Test | Steps | Expected result |
|---|---|---|---|
| 4.1 | Client filtering | On CLIENT_DASHBOARD, change the client picker cell. | The whole dashboard re-renders for the newly selected client (info block, task summary, current tasks, requests, issues, upcoming deadlines). |
| 4.2 | Employee filtering | Open TEAM_DASHBOARD. | One row per employee with correct counts; an employee whose open task count exceeds their Capacity shows "Overloaded" (red highlight). |
| 4.3 | Status filtering | On TASKS, filter/sort by Status. | Standard Sheets filtering works normally; conditional formatting colors match each status. |
| 4.4 | Monthly filtering | On MONTHLY_CLOSE_DASHBOARD, change the Client and Month filter cells. | Summary counts and the closing-stages strip update for that client/period. |
| 4.5 | Progress calculations | Compare a client's CLIENTS row (Simple/Weighted Completion %) against a manual count of its TASKS rows. | Simple % = Completed / (Total − Cancelled). Weighted % applies Critical=4/High=3/Medium=2/Low=1 weights to the same ratio. |
| 4.6 | Control Center KPIs | Compare the 9 KPI cards against manual counts in CLIENTS/TASKS. | Each matches (Total Clients, Active Clients, Onboarding, On Hold, Overall Completion %, Open/Overdue/Waiting Client/Blocked Tasks). |
| 4.7 | Charts | Open CONTROL_CENTER and scroll to the charts section. | All 6 charts render (Client Progress, Tasks by Status, Tasks by Employee, Overdue Tasks by Client, Client Health Distribution, Employee Workload) with current data. |

## 5. Edge cases

| # | Case | Expected result |
|---|---|---|
| 5.1 | Client with zero tasks | CLIENT_DASHBOARD renders without error; Task Summary cards all show 0; Current Tasks / Upcoming Deadlines tables are empty, not broken. |
| 5.2 | Fully completed client | Simple/Weighted Completion % = 100%; Client Health should be "On Track" (or "On Hold" if intentionally paused) — never "Delayed" purely from being finished. |
| 5.3 | On-hold client | Client Health always shows "On Hold" regardless of overdue tasks or open issues — the override is unconditional. |
| 5.4 | Cancelled task | Excluded from both Simple and Weighted Completion % denominators; Days Remaining/Overdue always blank/0 for it. |
| 5.5 | Missing Due Date | Days Remaining/Overdue show blank/0, not an error (`#REF!`/`#VALUE!`). |
| 5.6 | Missing Assignee | Team Dashboard doesn't error — an unassigned task simply isn't counted toward any employee's row. |
| 5.7 | Multiple overdue tasks | Once overdue count reaches the SETTINGS `HEALTH_DELAYED_TOTAL_OVERDUE_COUNT` threshold (default 3), health becomes "Delayed" even with no Critical-priority task involved. |
| 5.8 | Critical overdue task | A single overdue Critical-priority task forces "Delayed" immediately, regardless of the overall overdue count threshold. |

## 6. Re-running setup

`setupSpreadsheet()` is safe to run again at any time (e.g. after pulling an update): it never deletes data rows, only rebuilds headers/formulas/validation/protection/formatting and re-installs triggers without duplicating them. Confirm after a re-run: existing CLIENTS/TASKS rows are untouched, and `ScriptApp.getProjectTriggers()` still shows exactly 4 managed triggers, not 8.
