# Phase 9 — Team Dashboard & Management Report

**Status:** Complete
**Builds on:** the view models ported and parity-proven in
[`phase3-business-logic.md`](./phase3-business-logic.md), and the screens
delivered in Phases [4](./phase4-clients.md)–[8](./phase8-client-dashboard.md)

Phase 9 adds **no new metric**. Every figure comes from the Phase 3 ports of
`dashboards/TeamDashboardEngine.gs` (audit §8.5) and
`dashboards/ManagementReportLogic.gs` (audit §8.6). This phase is the two
screens, their drill-downs, and one correction to how assignments are matched.

---

## 1. What was built

| Route | Contents |
|---|---|
| `/team-dashboard` | One row per member: Member · Role · Assigned · Completed · In progress · Overdue · Waiting · Critical · Completion · Capacity · Overloaded/OK — legacy's eleven columns in order |
| `/management-report` | The four sections in the order `buildManagementReport` builds them: Client Performance, Team Performance, Operational Risks, Management Attention |

Both gate on `report:view` and are now linked from the sidebar rather than
showing as pending phases. Each member row links to that member's open tasks;
each risk card and health group links to the list behind it.

---

## 2. The correction: assignments joined by name (audit D4)

Legacy matched a task to a person by **display name**
(`t['Assigned To'] === e['Employee Name']`). The audit records this as defect
D4, and Phase 3's DIFF-4 committed CoreWorks to real foreign keys — but the
two team view models were still comparing names, because that is what the
parity harness compares against.

Shipping the Team Dashboard on top of that would have shipped a live bug:

> Two members who share a display name each get credited with the other's
> work. A team of two "John Smith"s reports **four** tasks where there are
> two, and both are judged overloaded on the other's workload.

`taskBelongsToMember` in `src/lib/domain/task.ts` now decides:

- When the task carries an `assignedToId` — every query from the database
  does — **the id decides**, and the collision cannot happen.
- When it does not, the **name** is used.

The second branch is not a fallback for production; it is what the parity
fixtures exercise. They mirror legacy rows, which have no ids, so the harness
still compares like for like against the original `.gs`. **All 1,670 parity
assertions pass unchanged.**

`DomainTask.assignedToId` is optional for exactly this reason, and the
`taskSelect` mapper now supplies it.

Proven live: two demo members both named "Sam Carter", one task each, showed
`assigned=1` on every row of both screens — total 2, matching the 2 real
tasks. A unit test pins both branches, including the legacy behaviour it
replaces, so the reason the id path exists stays visible.

---

## 3. Behaviours preserved deliberately

- **Critical counts open tasks only.** A completed critical task is not a live
  risk. Every other Team Dashboard column counts across non-cancelled tasks.
- **Cancelled tasks are excluded from every team count**, matching the shared
  `computeSimpleCompletion` population, so nobody is penalised for work that
  was called off.
- **A member with no capacity can never be flagged.** Legacy returns false
  rather than inventing a ceiling. A capacity of exactly **0** is a real value
  meaning "any open task is too many" — the page distinguishes the two, showing
  "Not rated" rather than an OK badge for an unset capacity.
- **Operational Risks uses mixed scopes**, and the page says so: critical
  issues and outstanding requests count open items only, while overdue and
  blocked run across every task. Legacy filtered neither of the latter.
- **Management Attention orders by category, not severity** — Delayed clients
  → Critical issues → Blocked tasks → Stale requests — and caps at **15**. A
  delayed client outranks any single issue because it is the aggregate signal.
  When the list hits the cap the page says so, rather than implying it is
  everything.

---

## 4. Security

Both pages gate on `report:view`; every role holds it today, so all five see
the same figures. Every drill-down checks the permission for its destination
before rendering a link.

Both services scope every query by `ctx.organizationId`. Verified live: a
neighbouring organization's member, client, and task appeared nowhere on
either page, and the neighbour's own report contained only their records.

---

## 5. Tests

**2,258 tests pass** across 30 files. Phase 9 contributes 31: 9 unit and 22
integration. Parity is unchanged at 1,670. The legacy suite is untouched at
110/111 — the one failure is the pre-existing `webappTemplates` defect
recorded as D1 in the Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/task-assignment.test.ts` | Both branches of `taskBelongsToMember`, that the id wins over a stale name, that an explicit null is unassigned, and the D4 double-count under the legacy rule that motivates the fix |
| `tests/integration/team-management.test.ts` | Every Team Dashboard column, the shared-name case end to end, the capacity/margin rules including unset-vs-zero, all four report sections, the category ordering, the 15-item cap, and cross-tenant isolation |

### Live verification

Against the production build and PostgreSQL with the demo seed:

| Check | Result |
|---|---|
| Team Dashboard: assigned / completed / in progress / overdue / waiting / critical / capacity, all 5 members | every cell matched independent SQL |
| Overloaded badges | 4 OK + 1 "Not rated" — matching the one member with no capacity |
| Member row → their open tasks | all 5 links matched their row's open count |
| Two members named "Sam Carter", 1 task each | `assigned=1` each on both screens; total 2, not 4 |
| Client Performance groups | On Track 3, At Risk 4, Delayed 2, On Hold 1 — matched SQL; On Track ordered by weighted completion |
| Operational Risks | overdue 4, critical issues 1, blocked 1, outstanding requests 4 — matched SQL |
| All 4 risk cards → destination lists | all agree |
| All 4 health groups → filtered client list | all agree |
| Management Attention | 5 items in category order, each labelled with its client |
| Cross-tenant | neither page leaked the neighbour's member, client, or task; the neighbour's own report was correct and separate |
| All five roles | 200 on both pages |
| Phases 0–8 screens | still 200 |

The two probe members and the neighbouring organization were removed
afterwards.

---

## 6. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Unchanged from Phases 4–8,
tracked for Phase 13.

---

## 7. Not in this phase

Audit §8.7 lists six charts from the legacy `_CHART_SRC` block. Both screens
here are the tabular views legacy built first; the charts are a presentation
layer over the same numbers and are not part of §8.5 or §8.6.

Monthly Close, task templates, and the generation jobs are Phase 10.
