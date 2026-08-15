# Phase 7 — Control Center

**Status:** Complete
**Builds on:** the view model ported and parity-proven in
[`phase3-business-logic.md`](./phase3-business-logic.md), and the list screens
delivered in Phases [4](./phase4-clients.md), [5](./phase5-tasks.md), and
[6](./phase6-issues-requests.md)

Phase 7 adds **no new metric**. All fourteen KPIs, the Active-only health
table, and the surfaced-issues panel come from
`buildControlCenterViewModel` — the Phase 3 port of legacy's
`webapp/ControlCenterViewModelLogic.gs`. Nothing on this page is recomputed in
a component.

What this phase adds is the *Control Center* half of the name: every number
now leads to the records behind it.

---

## 1. What was built

| Area | Detail |
|---|---|
| **Permission gate** | The page now checks `report:view`, like every other route |
| **KPI drill-downs** | 13 of the 14 KPIs link to the list holding exactly the records they count |
| **Record links** | Every client and issue row links to its own page |
| **Flagged behaviours surfaced** | The two legacy quirks are stated on the page, not just in code comments |
| **"As at" stamp** | The view model's `generatedAt`, previously computed and unused |
| **Nav consistency** | The Dashboard nav entry now declares the `report:view` it gates on |

---

## 2. The fourteen KPIs are unchanged

Audit §8.2 establishes that two Control Centers existed — the spreadsheet's 9
live-formula KPIs and the Web App's 14 — and that the CoreWorks brief's §16
list matches the Web App's fourteen exactly. That is the variant migrated, and
this phase does not touch it.

Verified live against independent SQL over the demo organization:

| KPI | Page | SQL |
|---|--:|--:|
| Total Clients | 10 | 10 |
| Active Clients | 7 | 7 |
| Onboarding | 2 | 2 |
| On Hold | 1 | 1 |
| Clients At Risk | 4 | 4 |
| Clients Delayed | 2 | 2 |
| Overall Completion % | 9% | 0.09 |
| Open Tasks | 10 | 10 |
| Overdue Tasks | 4 | 4 |
| Tasks Completed | 2 | 2 |
| Waiting on Client | 2 | 2 |
| Blocked Tasks | 1 | 1 |
| Open Issues | 4 | 4 |
| Issues Needing Attention | 3 | 3 |

---

## 3. The drill-downs, and why they need proving

A KPI that links somewhere showing a *different* number is worse than a KPI
that links nowhere — it makes the dashboard untrustworthy rather than merely
incomplete. So the link targets are treated as a correctness property, not a
UI detail.

`src/lib/dashboard/kpi-links.ts` declares one target per KPI. Three of them
are not one-to-one with a list's default view:

- **`totalClients`** counts every non-deleted client regardless of contract
  status, so it links to `status=ALL` rather than the list's default.
- **`overdueTasks`** pairs `overdue=true` with `status=ALL`, because the
  overdue filter supplies its own status constraint; leaving status off would
  let the list's `OPEN` default narrow it a second time.
- **`issuesNeedingAttention`** pairs `surfaced=true` with `status=ALL` for the
  same reason.

**`overallCompletionPct` has no link.** It is a mean, not a set — there is no
list of an average. It renders as a plain card while the other thirteen are
links.

Three layers check this:

1. `tests/unit/kpi-links.test.ts` — every KPI except the average has a target;
   every target parses under the schema its destination page actually uses;
   no filter is lost in that parse; the named permission is the one that
   guards the destination.
2. `tests/integration/control-center.test.ts` — for each of the 13 links,
   **the destination list's `total` equals the KPI's value**, against
   PostgreSQL, on a fixture built so every count is non-zero (a suite of
   zeroes would pass vacuously). One test then mutates the data and re-checks,
   so the two move together rather than coincidentally agreeing once.
3. Live verification — the same 13 comparisons over HTTP against the running
   production build.

---

## 4. The two flagged legacy behaviours are now visible

Both were preserved in Phase 3 with code comments. Phase 7 puts them on the
page, because they are the kind of quirk that misleads a reader who never
opens the source.

### Overall Completion % is a plain mean

Not a task-weighted global figure: a three-task client and a three-hundred-task
client contribute equally. Audit §8.2 flags this for product review. It is
preserved rather than quietly "improved" — changing it would move a number
management already tracks — and the page now says so beneath the cards.

An integration test asserts it equals the plain mean of the stored
`weightedCompletionPct` column, so a future "fix" cannot slip in unnoticed.

### Task KPIs are unscoped by client contract status

They count across *every* client, matching the spreadsheet's `COUNTIF`
formulas, while the health table below shows Active clients only (audit
conflict C5). Two different scopes on one screen is exactly the kind of thing
that reads as a bug, so the page states it.

Proven live rather than asserted: adding one blocked, overdue task to an
**On Hold** client moved Open Tasks 10→11, Overdue 4→5, and Blocked 1→2, while
the health table stayed at 7 rows and every client KPI was unchanged.

---

## 5. One defect fixed in passing

`clientListQuerySchema.includeArchived` used `z.coerce.boolean()`, which reads
any non-empty string as true — so `?includeArchived=false` would have
**included archived clients** on a URL that says not to. This is the same flaw
found in the task `overdue` filter during Phase 5; this instance is worse,
because it widens which records a user sees rather than narrowing them.

It now parses explicit tokens, with the six cases pinned in
`tests/unit/kpi-links.test.ts`. A drill-down test also asserts no KPI link
ever sets `includeArchived`, since the KPIs are computed over
`deletedAt: null`.

---

## 6. Security

The page had **no permission check** before this phase — the only route in the
app without one. Every role holds `report:view`, so nothing was exposed in
practice, but the gate was missing and is now in place.

Each KPI card also checks the permission for its *destination* before
rendering a link, so a role that could not open a list is never offered a card
that leads there. All six roles hold every relevant `:view` today; a unit test
asserts no drill-down is inert for a Viewer, so a future narrowing shows up as
a failure rather than a dead card.

Client and issue links on the page are gated the same way, falling back to
plain text.

---

## 7. Tests

**2,202 tests pass** across 27 files. Phase 7 contributes 94: 73 unit and 21
integration. The legacy suite is untouched at 110/111 — the one failure is the
pre-existing `webappTemplates` defect recorded as D1 in the Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/kpi-links.test.ts` | Coverage of every KPI, schema-validity of each target, no filter lost in parsing, permission correctness, the `includeArchived` token parsing |
| `tests/integration/control-center.test.ts` | The fourteen KPIs against a purpose-built fixture; Active-only health table and its sort; surfaced-issue ordering; soft-deleted records excluded from every count; tenancy; and the KPI↔destination equality for all 13 links |

### Live verification

Against the production build and PostgreSQL with the demo seed:

| Check | Result |
|---|---|
| 14 KPIs vs. independent SQL | all exact |
| 13 drill-downs: KPI value vs. destination page count | all 13 agree |
| Same 5 re-checked after mutating the data | still agree |
| Health table rows | 7, matching the Active-client count |
| Three non-Active clients | absent from the health table |
| Blocked overdue task added to an On Hold client | Open 10→11, Overdue 4→5, Blocked 1→2; health table unchanged at 7 |
| Overall Completion % card | renders as a `div`, not a link |
| Both caveats + Active-only note + "as at" stamp | rendered on the page |
| All five roles | 200, 13 linked cards, 7 client links, 3 issue links |
| Phases 0–6 screens | still 200 |

The probe task was removed afterwards.

---

## 8. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Unchanged from Phases 4–6.

**Resolved in Phase 14** for permission refusals — the check moved into `(app)/layout.tsx`, above the Suspense boundary that was committing the status. A record-level refusal still returns 200; see [`phase14-testing-security-deployment.md`](./phase14-testing-security-deployment.md) §1. The `report:view` gate on this page uses the same
mechanism.

---

## 9. Not in this phase

The Client Dashboard (Phase 8), Team Dashboard and Management Report (Phase 9)
are separate screens with their own view models — already ported in Phase 3
and reachable through `getTeamDashboard` / `getManagementReport`, but not yet
given pages.
