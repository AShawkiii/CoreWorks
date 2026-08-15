# Phase 8 — Client Dashboard

**Status:** Complete
**Builds on:** the view model ported and parity-proven in
[`phase3-business-logic.md`](./phase3-business-logic.md), and the record pages
delivered in Phases [4](./phase4-clients.md)–[6](./phase6-issues-requests.md)

Phase 8 adds **no new metric**. The seven summary cards, service-area
progress, and upcoming deadlines come from the Phase 3 port of legacy's
`dashboards/ClientDashboardEngine.gs`; the open task, request, and issue
tables come from the Phase 3 port of the Web App's client detail view model,
whose own comment records that it followed this sheet's precedent for exactly
those three sections.

---

## 1. What was built

`/client-dashboard` — legacy's dropdown-driven `CLIENT_DASHBOARD` sheet, with
the picker cell replaced by a `?clientId=` query parameter so a view is
shareable as a URL rather than living in a cell.

The seven sections, in the sheet's order (`CD_LAYOUT`):

| # | Section | Legacy source |
|---|---|---|
| 1 | Client info — 8 fields | `writeClientInfoBlock` / `INFO_FIELDS` |
| 2 | Seven summary cards | `writeTaskSummaryCards` / `SUMMARY_CARDS` |
| 3 | Service area progress | `writeServiceProgressTable` |
| 4 | Current tasks | `writeCurrentTasksTable` |
| 5 | Outstanding requests | `writeClientRequestsTable` |
| 6 | Open issues | `writeIssuesTable` |
| 7 | Upcoming deadlines (top 10) | `writeUpcomingDeadlinesTable` |

Navigation now links Client Dashboard rather than showing it as a pending
phase, and the client record carries a **Dashboard** button through to it.

---

## 2. The scope trap

Legacy's engine uses **two different scopes** on one screen, and getting one
wrong is invisible on the page:

- **Sections 1–3** see *every* task — the cards include Completed, and
  service-area progress divides completed by total.
- **Sections 4–6** show *open* items only.

`Cancelled` is excluded from the cards and from service progress, but is not
the same thing as "closed": Completed tasks are counted by the cards and
excluded from Current tasks.

Each scope is pinned by its own integration test, and one asserts the
relationship directly — `summary.total` must exceed `currentTasks.length`
whenever the client has any completed work.

---

## 3. A conflict between legacy's own two implementations

Legacy sorts undated tasks **differently in two places**:

| Implementation | Rule | Effect |
|---|---|---|
| `ClientDashboardEngine.gs` `writeCurrentTasksTable` | `new Date(due \|\| 0)` | epoch → undated sorts **first** |
| `ClientsViewModelLogic.gs` `taskDueDateSortKey` | `Infinity` when absent | undated sorts **last** |

The Web App's version carries an explicit comment arguing its own case: *"not
first — a missing date isn't 'most urgent'"*.

This is a new finding — the audit records conflicts C1–C8 but not this one.
**The Web App rule is the one migrated**, on two grounds: audit §8.2 already
established that where two legacy implementations differ the Web App variant
is authoritative, and `taskDueDateSortKey` is the version carrying parity
tests from Phase 3. A test asserts the last row is the undated one, with the
conflict written into the assertion so the reasoning survives.

Sorting undated work as most-urgent would put a task with no deadline above
one due tomorrow — the behaviour legacy's own newer code was written to fix.

---

## 4. Behaviours preserved deliberately

- **"Upcoming" deadlines include overdue work.** Legacy filtered on *open and
  has a due date*, not on the date being in the future, so a task three days
  past due still appears. Dropping it would hide exactly what the section
  exists to surface.
- **A blank service area groups under "Unspecified"** rather than being
  dropped, so per-area percentages still account for every task.
- **The info block reads stored derived columns** — health, simple and
  weighted completion, next deadline — rather than recomputing them. The
  engines that write those columns are proven in Phases 3 and 4.

---

## 5. Security

The page gates on `report:view`, like the Control Center. Every role holds it
today, so all five see the same dashboard.

`getClientDashboard` returns **null** for a client id that is not in the
caller's organization — the same answer as for an id that does not exist, so
the page cannot be used to probe which ids exist elsewhere. The page then
falls back to the caller's own first client rather than erroring, which is
legacy's behaviour (its engine cleared the sheet on an unknown name) with a
tenancy boundary added.

Task, request, and issue links are each gated on their own `:view`
permission, falling back to plain text.

---

## 6. Tests

**2,227 tests pass** across 28 files. Phase 8 contributes 25 integration
tests. The legacy suite is untouched at 110/111 — the one failure is the
pre-existing `webappTemplates` defect recorded as D1 in the Phase 0 audit.

`tests/integration/client-dashboard.test.ts` covers the seven cards against a
fixture where each is distinct, the two scopes, service-area grouping checked
against `computeSimpleCompletion` for every area, the undated-last sort, the
open-only tables, the deadline cap and its inclusion of overdue work,
soft-deleted records, and cross-tenant refusal.

### Live verification

Against the production build and PostgreSQL. The demo seed carries at most
two tasks per client, too thin to exercise the sections, so one client was
enriched with 10 tasks, 4 requests, and 4 issues spanning every status, then
the additions were removed.

| Check | Result |
|---|---|
| Seven cards vs. independent SQL | Total 11, Completed 3, In Progress 3, Not Started 2, Waiting Client 1, Blocked 2, Overdue 3 — all exact |
| Info block | health, simple 50%, weighted 50%, manager, package — all exact |
| Service areas | 7 rows alphabetical, Bookkeeping 67%, "Unspecified" present — all exact |
| Current tasks | 8 rows = SQL open count |
| Upcoming deadlines | 7 rows = SQL open-with-due-date count |
| Undated task | appears in Current tasks, absent from Upcoming deadlines |
| Cancelled task | absent from every section |
| Completed tasks | counted by the cards, absent from Current tasks |
| Received request / resolved issue | absent from their tables |
| Requests | 2 open, longest waiting first (18d then 6d) |
| Issues | 3 open, Critical → High → Medium |
| Picker | 10 clients alphabetical, defaults to the first |
| Cross-tenant `?clientId=` | no client name, no task name; picker unchanged; falls back to own first client |
| Nonexistent id | same fallback, no error |
| All five roles | 200, full dashboard |
| Phases 0–7 screens | still 200 |

---

## 7. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Unchanged from Phases 4–7.

**Resolved in Phase 14** for permission refusals — the check moved into `(app)/layout.tsx`, above the Suspense boundary that was committing the status. A record-level refusal still returns 200; see [`phase14-testing-security-deployment.md`](./phase14-testing-security-deployment.md) §1.

---

## 8. Not in this phase

Team Dashboard and Management Report (Phase 9). Both view models are already
ported and reachable through `getTeamDashboard` / `getManagementReport`; they
have no pages yet.
