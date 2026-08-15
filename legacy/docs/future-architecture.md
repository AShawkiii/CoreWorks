# Future Architecture — From V1 (Sheets) to a Web Application

Design only — nothing in this document is implemented. It exists so V1's architecture (see `architecture.md` §8's pure-logic/IO layering) can be evaluated against where the system is headed, not just where it is today.

## Why V1 is Sheets, and why that's not a dead end

Google Sheets + Apps Script was the right choice for V1: zero infrastructure, a UI every Finance Lab employee already knows, and fast iteration. The risk with that choice is normally "now we're stuck" — rewriting business logic from scratch to escape a spreadsheet. This system was deliberately built to avoid that: every business rule (progress weighting, health thresholds, ID generation, template expansion, due-date computation, the task status state machine, workload/staleness flagging) lives in a `*Logic.gs` file with zero `SpreadsheetApp` calls — see `architecture.md` §8. Those files are plain JavaScript. They are the migration path, not a rewrite target.

## Target stack

- **Frontend**: React/Next.js, two portals sharing a component library:
  - **Employee Portal** — Control Center, task management, client dashboards, team workload — a direct evolution of today's sheets, but interactive (inline editing, real-time updates, better filtering than Sheets allows).
  - **Client Portal** — a scoped view per client: their own task status, outstanding requests (with the ability to upload/respond directly instead of an employee manually marking "Received"), and high-level progress. Not something V1 offers today — Sheets has no per-client access boundary.
- **Backend**: Node.js (keeps the `*Logic.gs` files usable near-verbatim — see below) exposing a REST or GraphQL API. Each current `*Service.gs`/`*Engine.gs` becomes a backend route/resolver that calls the SAME pure logic function, replacing Sheets reads/writes with database queries.
- **Database**: PostgreSQL. `apps-script/config/Schemas.gs`'s header arrays map directly to table columns — CLIENTS, EMPLOYEES, SERVICES, SERVICE_PACKAGES, TASK_TEMPLATES, TASKS, CLIENT_REQUESTS, ISSUES, ACTIVITY_LOG, and MONTHLY_CLOSE each become a table with the same columns, the same enum constraints (from `Enums.gs`), and the same ID formats (from `IdLogic.gs`, trivially adaptable to a DB sequence or kept as-is for continuity). Foreign keys formalize what V1 does by string-matching (Client ID, Client Name).
- **Auth**: Role-based — Employee roles (from EMPLOYEES.Role/Department) map to permission scopes (e.g. Bookkeeper: edit own assigned tasks; Account Manager: edit their clients; Admin: SETTINGS-equivalent config). Client Portal users get a scoped, read-mostly role tied to exactly one client. This is the biggest capability gap V1 has today — Sheets sharing is all-or-nothing per sheet, not per-row.
- **Notifications**: Email/Slack alerts on: a task becoming overdue, a client's health dropping to Delayed, a Critical issue raised, a client request going stale. V1 has no notification layer today (Sheets alone can't push proactively without add-ons); a backend job queue makes this straightforward.
- **API integrations**:
  - **QuickBooks / Zoho Books** — pull actuals directly into MONTHLY_CLOSE (Sales, COGS, Expenses, etc.) instead of manual entry; two-way sync for bank reconciliation status.
  - **Shopify** — inventory/sales data for retail clients, feeding the Inventory service area.
  - **Google Drive** — attach client-provided documents directly to a Client Request instead of tracking receipt as a status flag only.
  - **Google Sheets** — kept as a legacy import/export path so clients or staff who prefer spreadsheets aren't locked out during transition.
  - **Looker Studio / Power BI** — read-replica connections to the Postgres DB for executive reporting beyond what the in-app dashboards cover.
  - **Banking APIs (e.g. Plaid)** — automate bank reconciliation's data feed, replacing manual statement uploads.

## Migration path

1. **Stand up the database** from `Schemas.gs`, seeded from an export of the live Sheet (Sheets stays the source of truth during this phase).
2. **Port the `*Logic.gs` files** into the backend almost unchanged — they were written with zero Apps Script dependency for exactly this purpose. `*Service.gs`/`*Engine.gs` files are rewritten (Sheets I/O → DB queries) but their function signatures and behavior stay the same, since the pure logic they wrap didn't change.
3. **Build the API** around those ported functions.
4. **Build the frontend**, initially read-only, cross-checked against the live Sheet for correctness.
5. **Cut over writes** once parity is confirmed; the Sheet becomes read-only or is retired.
6. **Add what Sheets couldn't do**: the Client Portal, real-time notifications, per-row access control, and the external integrations above.

## Access control (expanding on `docs/admin-guide.md`'s least-privilege note)

V1's access model is coarse: Editor/Viewer per sheet, plus computed-column protection. The web app's role-based model formalizes this:

| Role | Scope |
|---|---|
| Admin | Everything, including SETTINGS-equivalent configuration and user management. |
| Account Manager | Full edit on their assigned clients; read-only elsewhere. |
| Staff (Bookkeeper/Accountant/Analyst) | Edit their own assigned tasks; read-only on client info. |
| Client | Read-only on their own data, plus the ability to respond to/upload against their own open requests. |

This table is the natural extension of EMPLOYEES.Role/Department, which V1 already tracks but doesn't yet enforce access against.
