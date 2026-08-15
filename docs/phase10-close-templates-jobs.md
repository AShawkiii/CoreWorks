# Phase 10 — Monthly Close, Templates & Generation Jobs

**Status:** Complete
**Builds on:** the rules ported and parity-proven in
[`phase3-business-logic.md`](./phase3-business-logic.md), and every screen from
Phases [4](./phase4-clients.md)–[9](./phase9-team-management.md)

Phase 10 adds **no new business rule**. The close arithmetic, the template
catalog, and the generation dedupe all come from Phase 3 ports. This phase is
the screens, the mutations, and the scheduled jobs the audit says CoreWorks
needs.

---

## 1. What was built

| Route / entry point | Contents |
|---|---|
| `/monthly-close` | Close list with period, client, and status filters; open-a-close form |
| `/monthly-close/[id]` | The eighteen-stage board, derived status, and the period's task summary |
| `/templates` | The catalog per package, plus on-demand generation |
| `/services` | Every service and the packages that include it |
| `/service-packages` | Each tier's templates, clients, and service areas |
| `npm run job -- <name>` | The cron entry point for both scheduled jobs |

All four nav entries are now links rather than pending phases.

---

## 2. Two completion figures that must not be conflated

A close carries **stage completion** — `COUNTIF(stages,"Completed") /
COUNTA(stages)` over the eighteen stages, the number legacy's `MONTHLY_CLOSE`
row stored. The close dashboard carries **task completion** — over every task
for that client and period.

Legacy is explicit that the second counts the whole period *regardless of
service area*, because "the close" spans every deliverable due that month, not
only work tagged `Month-End Closing`. The detail page labels both and explains
the difference inline rather than showing one percentage and letting the reader
guess which question it answers.

Verified live: with all eighteen stages complete the close read 100% / Closed
while the period's task completion stayed below 100%.

---

## 3. The blank-stage trap, closed

Legacy's `COUNTA` denominator counted only **non-blank** stage cells. A close
where staff had touched one stage and marked it Completed therefore read
**100% and "Closed"** — one of one.

Every close created here materialises all eighteen stages with an explicit
Not Started, so the denominator is always eighteen (Phase 3 DIFF-1). Proven
live: completing the first stage moved the close to **5.6%**, not 100%.

`computeCloseCompletion` still honours blanks, so imported legacy rows behave
exactly as they did in the sheet.

---

## 4. Behaviours preserved deliberately

- **Stages have no transition table.** Legacy's stage columns were plain
  validated dropdowns and its `onEdit` handler routed only `TASKS.Status` — the
  same finding as Phase 6's issues and requests. Any stage status may follow
  any other; an integration test walks all twenty ordered pairs.
- **Close Status checks Closed before Blocked**, matching the legacy `IFS`
  order, so a fully complete close reads Closed and any blocked stage
  otherwise surfaces even when most of the close is done.
- **Pending excludes Blocked and Waiting Client** in the task summary; those
  have their own counts, and counting them again would hide that the work is
  stuck rather than merely unstarted.
- **Each package carries its own full set of templates** rather than
  referencing a shared pool, because legacy queried by exact package match.
  Full Finance's sixteen include Basic's nine as rows of its own — verified
  live at 9 / 16 / 22, totalling the audit's 47.
- **Generation is keyed on `clientId|serviceArea|taskName|period`**, so it is
  safe to re-run and prior periods are never touched. Verified live: a second
  pass created nothing, and a completed task from an earlier period kept its
  status while a new period generated.

---

## 5. The scheduled jobs (audit §9)

Legacy ran three time-based triggers. Two are reproduced:

| Legacy trigger | CoreWorks |
|---|---|
| `dailyRecalculation`, 02:00 | `npm run job -- daily-recalculation` |
| `runMonthlyTaskGeneration`, day 1 03:00 | `npm run job -- monthly-generation` |
| `generateMonthlyManagementReport`, day 1 04:00 | **not reproduced** — the report is derived live (Phase 9), so there is nothing to pre-build and its numbers are always current rather than as at the last run |

The daily pass is not a convenience. The audit's reasoning is that
**overdue-ness is time-dependent, not event-dependent**: a task becomes overdue
because the date rolled over, with nobody editing anything. CoreWorks
recalculates on every relevant mutation, which covers the event-driven half;
this job covers the other half.

An integration test reproduces exactly that: three tasks due on the 20th leave
a client On Track on the 15th and Delayed on the 25th, **with no edit in
between**. A second test shows the daily pass also catching an issue written
directly to the database, which no mutation hook would have seen.

Both jobs are also exposed in-app for an on-demand run — legacy's menu had the
same, for a client added mid-month. The CLI and the buttons call the same
functions, so they cannot drift.

`scripts/run-job.ts` sweeps **every** organization, since a deployment-level
cron is signed in as none of them. One tenant failing is reported and the rest
continue, and the exit code is non-zero if any failed, so a partial run cannot
look like success. Verified live: bad job name and bad period both exit 2, a
good run exits 0.

### A scheduled run is not a person

`ActivityLog.userId` is nullable with a `userEmail` snapshot beside it.
`systemContext` uses both: a nightly pass writes activity with a null user id
and `system@coreworks.local`, rather than attributing a recalculation to a
member of staff. `OrgContext.userId` and `membershipId` are nullable to make
that representable, and `requireUserId` guards the handful of operations that
are meaningless without a person — changing your own password or profile.

That change surfaced a latent bug worth naming: comment deletion compared
`comment.authorId !== ctx.userId`. A comment whose author has been deleted has
a **null** `authorId`, so a null-vs-null match would have let anyone remove it.
Both the shared and the task-specific paths now go through `requireUserId`, and
the UI checks explicitly rather than relying on the comparison.

---

## 6. Security

| Surface | Permission |
|---|---|
| View closes, templates, services, packages | `close:view` / `template:view` / `service:view` — every role |
| Open a close, move a stage, edit review | `close:manage` — Owner, Admin, Manager, Accountant |
| Run generation | `template:manage` — Owner, Admin, Manager |
| Run recalculation | `settings:manage` |

Verified live against all five demo roles: the open-close form appeared for
four and the generation panel for three, matching the matrix exactly —
including the Accountant's split, who can run a close but not generation.

Cross-tenant checks used a third organization with its own package, service,
template, client, and close. Neither its close detail, nor any of the four
catalog surfaces, leaked anything; a stage change against its close was
refused with the database unchanged; and the rival's own pages showed only
their records.

---

## 7. One config correction

`@typescript-eslint/no-unused-vars` was not honouring the `_` prefix the
codebase already uses for parameters that exist to satisfy a signature —
`useActionState` hands every action `(prevState, formData)` whether or not it
needs either. The rule now has explicit ignore patterns, verified to still
report a genuinely forgotten variable.

---

## 8. Tests

**2,330 tests pass** across 33 files. Phase 10 contributes 72: 21 validation,
44 integration, and 7 structural authorization guards the existing
`action-guards` suite generates automatically for the two new action modules.
Parity is unchanged at 1,670. The legacy suite is untouched at 110/111 — the
one failure is the pre-existing `webappTemplates` defect recorded as D1 in the
Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/validation-monthly-close.test.ts` | That completion, status, and display id are never accepted as input; the composite id format; and the close arithmetic including the empty-stage case and the Closed-before-Blocked order |
| `tests/integration/monthly-close.test.ts` | The eighteen stages and their order, the derived status through every state, `closedAt` stamping and clearing, all twenty stage-status pairs, the two completion figures, and cross-tenant refusal |
| `tests/integration/scheduled-jobs.test.ts` | The date-rollover case, idempotency, generation dedupe, prior-period safety, non-Active clients skipped, per-organization scoping, system-context activity, and one tenant's failure not stopping the rest |

### Live verification

Against the production build and PostgreSQL with the demo seed:

| Check | Result |
|---|---|
| Open a close | `MC-CL-0001-202608` — the legacy composite format, 18 stages, Not Started, 0% |
| Open the same period again | landed on the same close; one row total |
| Viewer / Team Member open | refused, no close created |
| Stage → Completed | 5.6% (1/18), status In Progress |
| Stage → Blocked | close reads Blocked |
| Unblock | back to In Progress at 11.1% |
| All 18 complete | Closed, 100%, `closedAt` set |
| Reopen one stage | In Progress, 94.4%, `closedAt` cleared |
| Viewer stage change | refused, 303 back with the reason, database unchanged |
| Templates page vs. SQL | "47 templates across 3 packages", blocks of 9 / 16 / 22 |
| Generate 2026-11 | 0 → 95 tasks |
| Generate 2026-11 again | still 95 |
| Generate 2026-12 | prior period untouched, including a manually changed status |
| Accountant generation | refused, 0 tasks |
| CLI runner | swept the org; bad job name and bad period exit 2, good run exits 0; re-run created 0 |
| Cross-tenant close, stage change, and all four catalog pages | no leak, no write |
| Phases 0–9 screens | still 200 |

The test tenant was removed afterwards.

---

## 9. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Unchanged from Phases 4–9.

**Resolved in Phase 14** for permission refusals — the check moved into `(app)/layout.tsx`, above the Suspense boundary that was committing the status. A record-level refusal still returns 200; see [`phase14-testing-security-deployment.md`](./phase14-testing-security-deployment.md) §1.

---

## 10. Not in this phase

Templates, services, and packages are **read-only** here. Creating and editing
them is not part of audit §6.12, which describes the seeded catalog; the
`template:manage` and `service:manage` permissions exist and currently gate
generation only.

Activity Log and Notifications are Phase 11.
