# Phase 6 — Issues & Client Requests

**Status:** Complete
**Builds on:** the business rules ported and parity-proven in
[`phase3-business-logic.md`](./phase3-business-logic.md), and the CRUD,
tenancy, and refusal patterns from [`phase4-clients.md`](./phase4-clients.md)
and [`phase5-tasks.md`](./phase5-tasks.md)

Phase 6 adds no new business rules. Issue surfacing, request ageing, the
days-waiting buckets, and the health consequences of an open issue all come
from Phase 3 domain functions. This phase is the screens, the mutations, and
the authorization around them.

---

## 1. What was built

| Area | Detail |
|---|---|
| **Issues list** (`/issues`) | Search, five filters, five sort orders, pagination at 50/page |
| **Raise issue** (`/issues/new`) | Accepts `?clientId=` to arrive pre-filled from a client page |
| **Issue detail** (`/issues/[id]`) | Status card, surfacing banner, comments, field sidebar |
| **Edit issue** (`/issues/[id]/edit`) | Every editable field **except** status |
| **Requests list** (`/requests`) | Search, five filters, six sort orders, days-waiting buckets |
| **Raise request** (`/requests/new`) | Accepts `?clientId=` |
| **Request detail** (`/requests/[id]`) | Status card, stale banner, comments, field sidebar |
| **Edit request** (`/requests/[id]/edit`) | Every editable field **except** status |
| **Comments** | On both entities; author-only removal |

Navigation now links Issues and Requests rather than showing them as pending
phases, and both client detail tabs link each row through to its record with
client-scoped "All …" and "Raise …" shortcuts.

---

## 2. Legacy rules this module consumes

Nothing here re-implements a rule. The services call Phase 3 functions:

| Legacy rule (audit ref) | Where it is used |
|---|---|
| `selectSurfacedIssues` (§6.5) | the "needing attention" filter and the detail banner |
| `isUnresolvedCriticalOrHigh` / `isOverdueIssue` (§6.5) | list rows, detail page |
| `isIssueOpen` / `ISSUE_CLOSED_STATUSES` (§6.5) | the OPEN filter, client detail rows |
| `flagStaleRequests` (§6.8) | the stale filter and the detail banner |
| `requestDaysWaiting` / `computeDaysWaiting` (§6.4) | every request row and detail |
| `bucketDaysWaiting` (§6.4) | the colour escalation on the requests list |
| `isRequestOpen` / `REQUEST_CLOSED_STATUSES` (§6.4) | the OPEN filter |
| `recalculateClientHealth` (§6.1) | issue create, severity/deadline edit, status change |

`selectSurfacedIssues` is singled out in the audit: legacy used the same
function for both the spreadsheet Control Center and the Web App, and it
**must not be re-derived**. The service narrows in SQL so paging stays
correct, then hands the page to that function for the final say — and an
integration test asserts the SQL loses nothing the function would keep.

---

## 3. The finding that shaped this phase: there is no state machine

Tasks have a transition table. Issues and requests do **not**, and that is a
deliberate preservation rather than an omission.

Legacy's installable `onEdit` handler
(`legacy/apps-script/automation/Triggers.gs:21-34`) routes exactly three
things: `TASKS.Status`, the Client Dashboard picker, and the Monthly Close
filters. Everything else is an explicit no-op. An issue's Status and a
request's Status were plain validated dropdowns — any value could follow any
other, with no check.

`IssueService.gs` exposes only `resolveIssue`; the other statuses were
reachable solely by typing in the cell. `ClientRequestService.gs`'s
`updateRequestStatus` accepts any status and validates none.

Inventing a workflow here would have been a new business rule, not a
migration. So both detail pages offer **every** status except the current one,
and an integration test walks all 12 ordered issue pairs and all 20 request
pairs to prove none is refused.

What legacy *did* enforce is preserved exactly:

- **Resolving an issue** stamps a Resolution Date, defaulting to today unless
  one is supplied — `resolveIssue(issueId, resolutionDate)`.
- **Receiving a request** stamps a Received Date the same way. That stamp is
  what freezes Days Waiting (audit §6.4).
- **Both** write their activity entry only when the status actually changed.

This is also why status is excluded from both edit forms: those side effects
belong to a status change, not to a field edit.

---

## 4. Deviations from legacy

| Legacy | CoreWorks | Why |
|---|---|---|
| Only the resolve path was logged; other status moves left no trace | Non-resolve moves log "Issue Status Changed" | A web backend has no unlogged direct-edit path. Staying silent would be a *worse* audit trail than legacy's, not a faithful one |
| No reopen path existed | Reopening a request clears its Received Date | Otherwise an outstanding request displays a receipt date. Closed→closed still keeps the stamp, matching legacy |
| `Days Waiting` was a live ARRAYFORMULA column | Derived on read, never stored | Master prompt §15; one fewer place for the number to go stale |
| Request/issue rows identified by row number | UUID primary key, `ISS-NNNN` / `REQ-NNNN` retained | Row numbers are not stable identifiers |
| No comment thread | Comments on both entities | Master prompt §43 |

The activity action constants for requests previously read "Request
Created"/"Request Updated". Nothing consumed them yet, and the activity feed
is user-visible legacy output, so they were corrected to the originals —
"Client Request Created" and "Client Request Status Changed".

---

## 5. Security

### Both permissions are flat

Unlike tasks, there is no assignee-dependent tier. The Phase 2 matrix gives
every role except Viewer a flat `issue:update` / `request:update`:

| Role | View | Create | Update |
|---|:-:|:-:|:-:|
| Owner / Admin / Manager / Accountant / Team Member | ✓ | ✓ | ✓ |
| Viewer | ✓ | — | — |

There is **no** `issue:delete` or `request:delete` permission, and none was
added. Legacy had no delete path for either entity, and Phase 2's RBAC is not
changed without a concrete requirement proving it wrong. Cancelling is the
intended way to retire a record.

### Commenting needs read access, not edit rights

As on tasks, a Viewer can comment — discussion should not require permission
to change the work. Removal is author-only; managers can still read a comment
they disagree with, because removal is not a moderation tool. Verified live in
both directions.

### Every id from a form is re-checked

`clientId` and `assignedToId` are verified against `organizationId` before
use, on create and on update, for both entities.

### Refusals carry their reason

The plain `<form action>` mutations — status changes and comment deletion —
redirect back with the message in `?error=`, rendered as an escaped alert
banner, exactly as Phase 5 established. Verified live with a `<script>`
payload.

---

## 6. Two implementation notes

### The surfaced filter and search must combine, not replace

Both the "needing attention" filter and the search term want a Prisma `OR`.
Assigning both to `where.OR` would let the second silently overwrite the
first, quietly widening a filtered view. They are combined with `AND`, and an
integration test raises two issues with a shared word — one surfaced, one not
— and asserts only the surfaced one comes back.

### Shared comment code

Issues and requests use one `CommentsPanel`, one `commentSchema`, and one
`comments.ts` service parameterised by parent, rather than three copies of the
same rules. Tasks keep their Phase 5 copy; it works and is tested, and
rewriting it was not part of this phase.

---

## 7. Tests

**2,108 tests pass** across 25 files. Phase 6 contributes 109: 39 validation,
58 integration, and 12 structural authorization guards the existing
`action-guards` suite generates automatically for the two new action modules.
The legacy suite is untouched at 110/111 — the one failure is the pre-existing
`webappTemplates` defect recorded as D1 in the Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/validation-issue.test.ts` | The two mandatory fields, that neither create nor update accepts a status, the optional resolution date, `surfaced` token parsing, length and date bounds |
| `tests/unit/validation-request.test.ts` | The same for requests, plus that Days Waiting, its bucket, and Received Date are all rejected as input, and the shared comment schemas |
| `tests/integration/issues-requests.test.ts` | All 12 issue and 20 request status pairs accepted; resolve/receive stamping and clearing; the surfaced and stale filters checked against `selectSurfacedIssues` and `flagStaleRequests` in both directions; every row's Days Waiting checked against `requestDaysWaiting`; health recalculation; comment authorship; cross-tenant refusal on every mutation |

### Live verification

Run against the production build and a real PostgreSQL database with the demo
seed, driving the actual server actions over HTTP:

| Check | Result |
|---|---|
| Issue counts vs. independent SQL | total 5, open 4, surfaced 3, critical 1 — exact; still exact (7/6/4/2) after live creates |
| Request counts vs. independent SQL | total 5, open 4, stale 1 — exact; still exact (6/5/2) after live creates |
| `?surfaced=false` / `?stale=false` | return everything, not the filtered set |
| Statuses offered | 3 of 4 on an Open issue, 4 of 5 on a Requested request — every status but the current one |
| Resolve → reopen | resolution date stamped, then cleared |
| Receive → Not Available → Requested | stamp kept across the closed pair, cleared on reopen |
| Create as Viewer | refused, 0 rows written |
| Create as Team Member | allowed, `ISS-0007` allocated |
| Critical issue raised | client moved to Delayed — the legacy health rule firing live |
| Stale request raised (26 days) | appears under the stale filter, banner and `15+` bucket shown |
| Viewer status change | refused, 303 back with the reason, database unchanged |
| Comment as Viewer | posted |
| Delete another user's comment | refused, 303 with the reason |
| Cross-tenant: detail, edit, search, status change, form options | no leak, no write, foreign member and client absent from both forms |
| Reflected `?error=<script>` | escaped |
| Phases 0–5 screens | still 200 |

One defect was found this way and fixed: reopening a request from *Not
Available* left its Received Date in place, so an outstanding request
displayed a receipt date. Days Waiting was unaffected — the domain function
ignores `receivedDate` for open statuses — but the field was misleading. The
clear now covers every closed status, with two integration tests pinning it.

Cross-tenant checks used a third organization created for the run and removed
afterwards.

---

## 8. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Verified again this phase
against `/issues/[id]`, `/issues/[id]/edit`, and `/requests/[id]` including
cross-tenant requests: no leak of either record's title. Unchanged from
Phases 4 and 5, tracked for Phase 13.

---

## 9. Not in this phase

The Control Center's surfaced-issues panel and the outstanding-requests
summary are Phase 7 — this phase supplies the functions and the screens they
will link to. Attachments on either entity are Phase 11.
