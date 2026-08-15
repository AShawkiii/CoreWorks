# Phase 5 — Tasks Module

**Status:** Complete
**Builds on:** the business rules ported and parity-proven in
[`phase3-business-logic.md`](./phase3-business-logic.md), and the tenancy and
CRUD patterns established in [`phase4-clients.md`](./phase4-clients.md)

Phase 5 adds no new business rules. The state machine, the overdue and
days-remaining arithmetic, and the completion side effects all come from Phase
3 domain functions. This phase is the screens, the mutations, and the
authorization around them.

---

## 1. What was built

| Area | Detail |
|---|---|
| **List** (`/tasks`) | Search, six filters, five sort orders, bulk selection, pagination at 50/page |
| **Create** (`/tasks/new`) | Ad-hoc tasks; accepts `?clientId=` to arrive pre-filled from a client page |
| **Detail** (`/tasks/[id]`) | Status card offering only legal transitions, comments, status history, field sidebar |
| **Edit** (`/tasks/[id]/edit`) | Every editable field **except** status |
| **Bulk operations** | Status change and reassignment across a selection |
| **Comments** | Post and remove; author-only removal |
| **Delete** | Soft delete, for tasks created in error |

Navigation now links Tasks rather than showing it as a pending phase, and the
client detail Tasks tab links each row through to the task, alongside "All
tasks" and "New task" shortcuts scoped to that client.

---

## 2. Legacy rules this module consumes

Nothing here re-implements a rule. The services call Phase 3 functions:

| Legacy rule (audit ref) | Where it is used |
|---|---|
| `validateTaskFields` (§6.3) | `createTask` — Client ID, Task Name, Service Area |
| `TASK_STATUS_TRANSITIONS` / `nextStatusAllowed` (§6.3) | every status change, single and bulk |
| `updateTaskStatus` side effects (§6.3) | completion stamping, reopening, activity log |
| `computeDaysRemaining` / `computeDaysOverdue` (§6.4) | list rows, detail page, overdue filter |
| `isTaskOpen` / `TASK_CLOSED_STATUSES` (§6.4) | the OPEN filter, client detail task rows |
| `recalculateClientProgress` (§6.2) | after any status, priority, due-date, or client change |
| `recalculateClientHealth` (§6.1) | same |

### The status-change sequence

A status change is a distinct operation, not a field edit. `updateTaskStatus`
runs the legacy order:

1. Load the task, scoped to the caller's organization.
2. Reject the move if `nextStatusAllowed` forbids it.
3. Return early if the status is unchanged — a no-op writes no history.
4. Apply completion side effects: moving **to** Completed stamps the
   completion date and sets 100%; moving **out of** Completed clears the date.
5. Write a `TaskStatusHistory` row naming the mover.
6. Log the activity.
7. Recalculate the client's progress, then health.

Steps 4–7 are why status is excluded from `updateTaskDetails`. Folding the two
together would either skip these effects or fire them on every trivial edit.

---

## 3. Three behaviours worth knowing

### The list defaults to open work

`/tasks` with no `status` parameter shows OPEN — everything except Completed
and Cancelled. A list dominated by completed history is not what anyone opens
this page for. `?status=ALL` shows everything.

### Bulk status skips rather than forces

Each selected task is evaluated against the state machine individually. A task
whose current status forbids the move is **skipped and reported**, not forced.
Applying it silently would corrupt exactly the audit trail the state machine
exists to protect. A run that partially applies says what it skipped and why.

Ids that belong to another organization are counted as skipped without being
named, so the count cannot be used to probe whether a task id exists.

### The UI offers only legal moves

`getTaskDetail` returns `allowedTransitions`, computed by running
`nextStatusAllowed` against every status. The detail page renders one button
per permitted move and nothing else. Cancelled has no outgoing transitions and
says so explicitly rather than showing an empty row.

---

## 4. Deviations from legacy

| Legacy | CoreWorks | Why |
|---|---|---|
| An invalid status edit was written to the sheet, then reverted with a toast | The move is refused before any write | The sheet had no other way to intercept an edit; a server action does |
| Bulk edits were a manual multi-cell paste with no validation | Bulk operations run the state machine per task | Same rule, now actually enforced |
| No comment thread | Comments per task, author-only removal | Master prompt §43 |
| Task rows identified by row number | UUID primary key, `TSK-NNNNNN` display id retained | Row numbers are not stable identifiers |

None of these change a business rule. The state machine, the required fields,
and the completion side effects are exactly what the legacy code does.

---

## 5. Security

### Task editing has a second layer

Five roles hold `task:view`, but editing splits:

| Role | Create | Edit any task | Edit own task | Delete | Bulk |
|---|:-:|:-:|:-:|:-:|:-:|
| Owner / Admin / Manager | ✓ | ✓ | ✓ | ✓ | ✓ |
| Accountant | ✓ | ✓ | ✓ | — | ✓ |
| Team Member | — | — | ✓ | — | — |
| Viewer | — | — | — | — | — |

A Team Member holds `task:update_own`, not `task:update`, so the decision
depends on whether they are the assignee — which a static permission check
cannot answer. `requireTaskPermission` in `src/server/actions/tasks.ts`
resolves the assignee from the database first, then calls `canUpdateTask`.

The structural guard in `tests/unit/action-guards.test.ts` was extended to
recognise module-local `require*` helpers, and to assert that each such helper
performs a real check — otherwise a helper named `require…` could launder an
unguarded action past the test.

### Commenting needs read access, not edit rights

`addTaskCommentAction` requires only an authenticated org context. Discussion
should not require permission to change the work, so a Viewer can comment.
Removal is author-only: managers can still read a comment they disagree with,
because removal here is not a moderation tool.

### Every id from a form is re-checked

`clientId`, `assignedToId`, and `reviewerId` all arrive from a `<select>` and
are all verified against `organizationId` before use. A foreign member id would
otherwise assign this organization's work to another tenant's staff.

### Refusals now carry their reason

`changeTaskStatusAction`, `deleteTaskAction`, and `deleteTaskCommentAction` are
plain `<form action>` submissions from a Server Component, so they cannot
return a `FormState`. They previously threw, which handed the user Next's
generic error boundary — and in production the real reason is redacted, which
is the one thing they need.

They now redirect back to the task with the message in `?error=`, which the
detail page renders as an alert banner. The reflected value is rendered as
text, so React escapes it.

This matters because a refusal is genuinely reachable even though the UI only
offers legal moves: two people working from stale views, or a permission
revoked between render and submit. Legacy surfaced the same condition as an
explanatory toast.

---

## 6. One defect fixed in passing

`taskListQuerySchema.overdue` used `z.coerce.boolean()`, which treats any
non-empty string as true — so `?overdue=false` turned the filter **on**. The
checkbox in the UI submits `""` when unchecked, so the bug was invisible
through the interface but live for anyone editing the URL or sharing a link.
It now parses explicit tokens (`"true"` / `"1"`), verified live: `?overdue=true`
returns 2 rows, `?overdue=false` returns all 13.

---

## 7. Tests

**1,999 tests pass** across 22 files. Phase 5 contributes 77 of them: 31
validation, 45 integration, and one new structural guard. The legacy suite is
untouched at 110/111 — the one failure is the pre-existing `webappTemplates`
defect recorded as D1 in the Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/validation-task.test.ts` | Required fields, period format boundaries (month 00/13, unpadded, full date), length caps, bulk batch limits, the `overdue` token parsing, that neither create nor update accepts a status |
| `tests/integration/tasks.test.ts` | The state machine end-to-end against PostgreSQL — every illegal move out of Completed, Cancelled as terminal, no-op writes no history — plus bulk skip semantics, comment authorship, soft deletion, and cross-tenant refusal on every mutation |

### Live verification

Run against the production build and a real PostgreSQL database with the demo
seed, driving the actual server actions over HTTP:

| Check | Result |
|---|---|
| List counts vs. independent SQL | total 13, open 9, overdue 2, unassigned 1, critical 1 — all exact |
| `?overdue=false` | 13 rows (the fix; would have been 2 before) |
| Create via server action | `TSK-000013` allocated sequentially, defaults correct, redirect to detail |
| Create as Viewer / Team Member | refused, 0 rows written |
| Team Member, own task, legal move | applied |
| Team Member, own task, illegal move | refused, 303 back with the reason, database unchanged |
| Team Member, task they are not assigned to | refused |
| Viewer status change | refused |
| Bulk across mixed statuses | 2 legal moves applied, the Cancelled task untouched |
| Bulk as Team Member / Viewer | refused, no rows changed |
| Comment as Viewer | posted |
| Delete another user's comment | refused, 303 with the reason |
| Cross-tenant: detail, edit, search, status change, form options | no leak, no write, foreign member and client absent from the form |
| Reflected `?error=<script>` | escaped |
| Phases 0–4 screens | still 200 |

Cross-tenant checks used a second organization created for the run and removed
afterwards.

---

## 8. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Verified again this phase: the
response for an unauthorized edit page contains no form and no task fields.
This is a status-code defect, not an authorization hole, and is unchanged from
Phase 4.

---

## 9. Not in this phase

Issues and Requests (Phase 6), task templates and monthly generation UI
(Phase 10), and the team workload views (Phase 9). Recurring tasks are still
produced by the generator; this module manages ad-hoc work and everything the
generator has already created.
