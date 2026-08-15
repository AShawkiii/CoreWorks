# User Guide — Finance Lab Client Delivery Management System

For Finance Lab staff using the system day to day (account managers, bookkeepers, accountants, FP&A analysts). No technical background needed — this covers reading the dashboards and updating your own work.

## Getting oriented

When you open the spreadsheet, use the **Finance Lab** menu (next to File/Edit/View) to jump anywhere — it lists every major section plus a few "Run" actions. Every dashboard also has quick links in the top-right corner (columns L onward) for jumping between Control Center, Clients, Tasks, and the other dashboards.

## Control Center

Your first stop. Along the top: 9 numbers (KPI cards) giving the whole-company picture — total/active clients, overall completion, open/overdue/waiting/blocked tasks. Below that:

- **Client Health table** — every client, their account manager, progress %, open/overdue/waiting-client task counts, next deadline, and health color (🟢 On Track, 🟡 At Risk, 🔴 Delayed, ⚪ On Hold).
- **Issues requiring attention** — every Critical/High-severity or overdue issue, across all clients.
- **Charts** — visual breakdowns of progress, task status, workload, and more.

This refreshes automatically once a day, and any time someone clicks **Finance Lab → Run: Rebuild Dashboards**.

## Client Dashboard

Pick a client from the dropdown at the top of CLIENT_DASHBOARD. The whole sheet updates for that client: contact/package info, task counts, per-service-area progress, their current open tasks, what you're waiting on from them, their open issues, and their next 10 deadlines. This is the sheet to have open before a client call.

## Working a task

Open TASKS (or find "your" tasks via TEAM_DASHBOARD or your client's Client Dashboard). To update a task:

1. Find the row (filter by Assigned To = your name, or Status, if the list is long).
2. Change the **Status** cell as work progresses: Not Started → In Progress → (In Review, if it needs review) → Completed. If you're stuck, set it to **Blocked** and fill in what's blocking it. If you're waiting on the client, set it to **Waiting Client**.
3. That's it — Days Remaining/Days Overdue update automatically, and moving something to Completed stamps the completion date and updates your client's progress.

**A rejected status change isn't a bug** — if you try to skip a step the system doesn't allow (e.g. jumping a task straight from Not Started to Completed, or reopening something that isn't Completed), it reverts and shows a message. Move it through the normal statuses instead.

## Logging what you're waiting on from a client

Add a row to CLIENT_REQUESTS: Client, what you asked for (Request), Requested Date, and Priority. Update its **Status** as things move (Requested → Partially Received / Received, or Not Available / Cancelled if it's off the table). Days Waiting updates automatically, and anything sitting for 15+ days gets flagged.

## Logging a problem

Add a row to ISSUES: Client, what's wrong (Issue), a Category, Severity (Low/Medium/High/Critical), and what needs to happen (Required Action). Set a Deadline if there's one. Critical and High issues — and anything overdue — automatically surface on the Control Center so management sees it. Mark it **Resolved** once it's handled.

## Understanding client health colors

- 🟢 **On Track** — nothing unusual.
- 🟡 **At Risk** — something needs eyes soon: an overdue task, an important deadline coming up fast, or an open High-severity issue.
- 🔴 **Delayed** — something's actually missed or serious: a Critical task overdue, several overdue tasks piling up, or a Critical issue open.
- ⚪ **On Hold** — the engagement is intentionally paused (set on the client's Contract Status). This always wins over the other colors.

You don't set this by hand — it's calculated automatically from tasks and issues.

## Team Dashboard

One row per employee: their task counts, completion %, and a workload flag. "Overloaded" means their open task count has exceeded their set capacity — worth a conversation about redistributing work, not a judgment.

## Monthly Close Dashboard

Pick a Client and a Month (format `YYYY-MM`, e.g. `2026-08`). Shows that period's close progress and a color strip across all 18 closing stages (Sales through Final Approval) so you can see exactly where the close stands.
