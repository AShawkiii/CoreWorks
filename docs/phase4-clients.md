# Phase 4 — Clients Module

**Status:** Complete
**Builds on:** the business rules ported and parity-proven in
[`phase3-business-logic.md`](./phase3-business-logic.md)

Phase 4 adds no new business rules. Every calculation on these screens comes
from a Phase 3 domain function; this phase is the CRUD, the screens, and the
tenancy guards around them.

---

## 1. What was built

| Area | Detail |
|---|---|
| **List** (`/clients`) | Search, filters (status, health, account manager, include-archived), four sort orders, pagination at 25/page |
| **Create** (`/clients/new`) | Full form; generates onboarding tasks and primes derived fields |
| **Detail** (`/clients/[id]`) | Eight tabs: Overview, Tasks, Issues, Requests, Contacts, Services, Activity, Notes |
| **Edit** (`/clients/[id]/edit`) | Same form, pre-filled; a contract-status change re-derives health |
| **Archive / restore** | Soft delete; history and tasks retained |
| **Contacts** | Add, edit, remove; exactly one primary enforced |

Navigation now links Clients rather than showing it as a pending phase.

---

## 2. Legacy rules this module consumes

Nothing here re-implements a rule. The service calls Phase 3 functions:

| Legacy rule (audit ref) | Where it is used |
|---|---|
| `validateClientFields` (§6.9) | `createClient` — the four required fields, including **Start Date** |
| `isDuplicateClient` (§6.9) | create and update — duplicate requires name **and** company to match |
| `generateOnboardingTasks` (§6.11) | create — expands the package's templates |
| `recalculateClientProgress` (§6.2) | create, and after task changes |
| `recalculateClientHealth` (§6.1) | create, and on contract-status change |
| `buildClientsListViewModel` | list, when sorting by urgency |
| `buildClientDetailViewModel` | detail — open tasks/issues/requests, in legacy order |
| `buildClientTaskSummary`, `buildServiceAreaProgress` (§8.4) | detail Overview |
| `logActivity` (§6.14) | every mutation; also stamps `lastActivityAt` |

### The create sequence

`createClient` preserves legacy `createNewClient` step for step:

```
assert references belong to this organization   ← added, see §4
validate required fields                        ← legacy
reject duplicate (name AND company)             ← legacy
allocate display id → insert → log activity     ← legacy
generate onboarding tasks from the package      ← legacy
recalculate progress                            ← legacy
recalculate health                              ← legacy
```

The last two matter and are easy to drop: legacy primed both so a new client's
completion and health are right the moment it appears, rather than staying at
zero until the nightly pass.

---

## 3. Two list behaviours worth knowing

**The list shows ALL clients; the Control Center health table shows only
Active ones.** That is legacy behaviour, not an inconsistency — the Clients
page has its own status filter, while the Control Center table represents the
live roster (audit conflict C5). Live verification confirmed both: the list
renders all 10 demo clients including On Hold and Onboarding; the Control
Center renders 7.

**Sorting by urgency happens after retrieval, not in SQL.** The health enum's
storage order is not its urgency order, so `ORDER BY health` would be wrong.
The ported `buildClientsListViewModel` applies `healthSortRank` to the fetched
page. Filtering, counting, and pagination remain in SQL (master prompt §47) —
only the ordering of the retrieved page is applied in application code, so the
cost is bounded by page size.

---

## 4. Deviation from legacy

**Tenancy assertion runs before business validation.**

Legacy validated on resolved *names* — it looked up the service package and
account manager, then checked they were present. Carrying that order over
meant an id belonging to another organization failed to resolve and surfaced
as *"Service Package is required"*: a correct refusal with a misleading
message, sending the user to hunt for a field they had filled in.

`assertReferencesInOrg` now runs first, so a cross-tenant id is refused as
*"Service package not found in this organization."* The legacy validation
still runs, unchanged, immediately after.

Two integration tests caught this by asserting the error *type* rather than
just that it threw.

---

## 5. Security

Every action authorizes before reading input:

| Action | Permission |
|---|---|
| `createClientAction` | `client:create` |
| `updateClientAction` | `client:update` |
| `toggleClientArchivedAction` | `client:archive` |
| `saveClientContactAction`, `deleteClientContactAction` | `client:update` |

`organizationId` is never accepted from a form — it comes from the session.
Every id supplied by the browser (service package, account manager, backup
member, client, contact) is verified to belong to the caller's organization
before use; a foreign id is refused with "not found in this organization",
which does not confirm it exists elsewhere.

Verified live across roles: an Owner sees the New client button, Edit link,
and Archive control; a Viewer sees none of them, and their `/clients/new` and
`/clients/[id]/edit` responses contain no form and no client field values.

One defect found and documented rather than papered over: programmatic
`notFound()` returns HTTP 200 instead of 404. No data exposure; recorded in
[`security.md`](./security.md) and tracked for Phase 13.

---

## 6. Tests

| Suite | Tests |
|---|---|
| `tests/unit/validation-client.test.ts` | 23 — date parsing, required Start Date, UUID references, list-query defaults |
| `tests/integration/clients.test.ts` | 29 — create sequence, duplicates, cross-tenant refusals, archive/restore, list filtering and ordering, detail assembly, contacts |

**Totals after Phase 4: 20 files, 1,913 tests** (1,670 parity · 168 unit ·
75 integration). The legacy suite is untouched at 110/111.

Cross-tenant coverage specifically: creating with another organization's
service package or account manager, updating another organization's client,
archiving one, reading one via `getClientDetail`, and adding a contact to one
— all refused, with the target row verified unchanged afterwards.

---

## 7. Not in this phase

| Item | Phase |
|---|---|
| Task management from the client detail Tasks tab (currently read-only) | 5 |
| Issue and request creation from their tabs (read-only) | 6 |
| Documents / attachments tab | 12 |
| Bulk client operations, CSV import | 12–13 |
| Comments on clients | 11 |
