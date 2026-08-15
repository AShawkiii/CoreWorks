# Phase 11 — Activity Log & Notifications

**Status:** Complete
**Builds on:** the activity writer ported in
[`phase3-business-logic.md`](./phase3-business-logic.md), the scheduled jobs in
[`phase10-close-templates-jobs.md`](./phase10-close-templates-jobs.md), and
every mutation from Phases [4](./phase4-clients.md)–[9](./phase9-team-management.md)

Phase 11 delivers two features with very different provenance, and it matters
which is which:

- **The Activity Log** is a *reader* over data the ported rules already write.
  Legacy `automation/ActivityLogger.gs` (audit §6.14) has been in place since
  Phase 3; what it never had was a screen — the ACTIVITY_LOG sheet was scrolled
  and filtered by hand.
- **Notifications are net-new.** The audit lists them as **Absent** from legacy
  and authorized as a CoreWorks addition (§15). Nothing in the notification
  code is a port, so nothing in it claims to be one.

---

## 1. What was built

| Route / entry point | Contents |
|---|---|
| `/activity` | The organization-wide audit trail, with seven filters |
| `/notifications` | Your own feed, read/unread, deep links |
| `/settings/notifications` | Per-user, per-type delivery preferences |
| Header bell | Unread count, on every authenticated page |

All three remaining phase-11 nav entries are now links rather than pending
phases.

---

## 2. The Activity Log is append-only, and stays that way

Entries are written exclusively by `services/activity.ts`, called from the
service that performs the change being recorded. The new module,
`services/activity-queries.ts`, **reads only** — a test asserts it exports no
function whose name begins `create`/`update`/`delete`/`remove`/`edit`, and a
second asserts `validation/notification.ts` declares no activity write schema.

An audit trail a user can edit through the screen that displays it is not an
audit trail. Those two tests exist so a future phase cannot quietly add one.

### Three kinds of actor, kept distinct

| On screen | Stored as | Means |
|---|---|---|
| **Scheduled job** | `userId` null + `userEmail` = `system@coreworks.local` | A nightly or monthly pass (Phase 10's `systemContext`) |
| A person's name | `userId` set | Still on the team |
| Their email address | `userId` null, `userEmail` set | Since removed — the snapshot is all that survives |

The middle and bottom rows are the reason audit D4 called for storing the
email. The top and bottom **both** have a null `userId`, so the `Scheduled
jobs` filter tests the email as well; filtering on the null alone would
attribute a departed colleague's work to the machine. An integration test
creates exactly that pair and asserts they are told apart.

The `Scheduled jobs` filter option only appears once such an entry exists, so
it can never select an empty set.

### Two legacy rules the screen states rather than hides

Both are printed under the table, because a reader who does not know them will
mistake them for missing data:

- **Recalculation that changes nothing is never logged.** Verified live: a
  nightly pass over ten clients with `healthChanged=0` wrote no entries at all;
  a second pass, after the health values were reset, wrote seven.
- **A bulk operation writes one summary entry, not one per record.** Verified
  live: reassigning two tasks produced a single `2 task(s) → Tomas Novak` row
  with a null `entityId`.

Actions are offered in the filter as **the distinct values present in the
data**, not as today's `ACTIVITY_ACTIONS` constants. Legacy wrote action names
as free text and imported history can hold values this codebase no longer
emits; listing only the constants would leave those rows unfindable.

---

## 3. Notifications: four rules, enforced in one place

Every emitter goes through `createNotifications`, so none of them can forget:

1. **Addressed to a USER, not a member.** `Notification.userId` is a user;
   tasks, issues, and requests are assigned to an `OrganizationMember`. The
   resolution is scoped to the caller's organization and to *active* members,
   so a member id from another tenant resolves to nothing rather than to that
   tenant's staff.
2. **Never notify yourself.** Assigning yourself a task tells you nothing you
   did not just do. A scheduled run is exempt because `ctx.userId` is null and
   null never equals a real id — proven by a test, since getting this wrong
   would silently mute the nightly pass for everyone.
3. **Preferences are checked here, once.** An absent row means enabled.
4. **Delivery never fails the mutation that caused it.** Reassigning a task
   must not 500 because a notification row could not be written. `deliver`
   catches, logs, and returns 0 — the only deliberate swallow in the codebase,
   and it is justified by the write already having happened.

### What generates what

| Type | Raised by | Sent to |
|---|---|---|
| `TASK_ASSIGNED` | create, edit, bulk reassign | The new assignee |
| `ISSUE_ASSIGNED` / `REQUEST_ASSIGNED` | create, edit | The new assignee |
| `CLIENT_HEALTH_CHANGED` | the health engine, only on a real change | Account manager + backup |
| `TASK_DUE_SOON` / `TASK_OVERDUE` | the nightly pass | The assignee |
| `MENTION` | any comment | Everyone named |
| `SYSTEM` | monthly generation | Owners and admins |

Three deliberate asymmetries:

- **Bulk reassignment sends one notification per task** while writing one
  summary activity entry. They answer different questions: the feed records
  that a run happened; the new owner needs each task individually, because "you
  now own 12 tasks" is not something you can click.
- **Generated tasks send nothing.** `createTask` gates the notification on the
  same `skipLog` flag as the activity entry — monthly generation creates
  hundreds of rows, and a notification each would bury every real one. The run
  sends a single `SYSTEM` summary instead.
- **Losing a record is silent.** The new owner is told; the previous one is
  not. That is a management conversation, not a system message.

`CLIENT_HEALTH_CHANGED` goes to the two people the schema says own the
relationship, **not** to everyone with `client:view`. On a book of two hundred
clients the latter is a nightly flood nobody reads, which is how a notification
system becomes noise.

### The due-soon window is not a new number

`deadlineReminderFor` takes the organization's
`HEALTH_AT_RISK_DUE_SOON_DAYS` setting — the same horizon the health rule
already calls imminent (audit §6.1). A second, separately-tuned constant would
let the sidebar and the client's health disagree about what "soon" means. A
test widens the setting to 10 and watches a six-day-out task start reporting.

This job exists for the reason the audit gives for the daily recalculation
(§9): **a deadline passes because the date rolled over, not because anyone
edited anything.** No mutation hook will ever fire for it. It runs *third* in
`runDailyRecalculation`, after progress and health, so nobody is told their
task is overdue before the client it belongs to has been marked Delayed for
that same fact.

It is safe to re-run: a task already notified with the same type **today** is
skipped, keyed on entity and type rather than on the recipient. Verified live —
a second CLI run reported `dueSoonNotices=0 overdueNotices=0` and created
nothing, while running it against the next day sent again, because the fact had
changed.

---

## 4. Mentions

`parseMentions` is pure and matches `@` followed by a member's display name,
case-insensitively. Three rules make it predictable rather than clever:

1. **Longest name first** — with both "John" and "John Smith" on the team,
   `@John Smith` reaches John Smith and does *not* also ping John.
2. **A match must end on a word boundary** — `@Johnson` is not a mention of
   John, and `team@Annex.com` is not a mention of Ann.
3. **Each person at most once**, however many times they are written.

A member whose name is blank is skipped, or a bare `@` in "email me @ the
office" would mention them on every comment anyone writes.

There is **no autocomplete picker**. That is a UI addition which would change
no rule here; the comment box states the syntax instead. Mentions are wired
into all three comment surfaces — tasks, issues, and requests — through the two
functions that create comments, so a fourth surface gets it by construction.

---

## 5. Preferences

A new `NotificationPreference` model (one migration) holds one row per user,
organization, and type. Two decisions:

- **An absent row means enabled.** Only explicit choices are stored, so a
  notification type added in a later phase reaches everyone the day it ships,
  with no backfill and no silent gap while rows are missing.
- **Scoped to the organization as well as the user**, so someone who belongs to
  two tenants can be noisy in one and quiet in the other.

`SYSTEM` is not configurable and is not rendered as a checkbox at all, rather
than rendered disabled — a control that cannot be changed invites the reader to
try. It carries the outcome of scheduled runs, which the people who receive it
are accountable for checking. The action strips it before validation and the
service never writes a row for it.

**There are no email or push toggles.** CoreWorks has no mail transport, and a
switch for a channel that does not exist would be a setting that silently does
nothing. The settings page says so on the page rather than leaving the reader
to wonder.

---

## 6. Security

| Surface | Guard |
|---|---|
| `/activity` | `activity:view` — Owner, Admin, Manager only |
| `/notifications`, `/settings/notifications` | **Authentication only** |

The second is the design, not an omission. A notification is addressed to a
user id and every query is scoped by it, so there is nothing a role could grant
or withhold — a permission could only deny someone their own. The actions
therefore use `requireOrgContext` rather than `requirePermission`, and the
`where` clauses carry the user id so that a notification belonging to someone
else is *not found* rather than checked-then-updated.

Verified live against all five demo roles: `/activity` rendered for Owner and
Manager and was refused for Accountant, Team Member, and Viewer, with the
sidebar link present for exactly the first two. Notifications and their
settings rendered for all five.

Forging another user's notification id was refused with a 303 back and a
readable reason, and the row was confirmed unchanged. Cross-tenant checks used
a second organization: neither its activity nor its notifications appeared for
the first organization at any filter — including a search for its distinctive
client name, which returned zero results with only the echoed search term on
the page — and the reverse held too.

---

## 7. Tests

**2,434 tests pass** across 37 files. Phase 11 contributes 100: 44 unit,
56 integration, and 4 structural authorization guards the existing
`action-guards` suite generates automatically for the new action module.
Parity is unchanged at **1,670**. The legacy suite is untouched at **110/111** —
the one failure is the pre-existing `webappTemplates` defect recorded as D1 in
the Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/notification.test.ts` | Mention matching including the longest-name, word-boundary, blank-name, and email-address cases; the reminder window at its edges and with a widened or zero setting; reminder wording |
| `tests/unit/validation-notification.test.ts` | That `unread` is parsed by token rather than `z.coerce.boolean()`; that SYSTEM is refused as a preference; that no activity write schema exists |
| `tests/integration/notifications.test.ts` | All four delivery rules, every emitter, the skipLog gate, bulk semantics, the nightly pass including same-day idempotency and date rollover, read/unread, cross-user refusal, and per-organization preferences |
| `tests/integration/activity-log.test.ts` | Every filter, the date-range end-of-day case, ordering and paging, tenant scoping, the scheduled-vs-deleted-user distinction, and the append-only assertions |

### Live verification

Against the production build and PostgreSQL with the demo seed:

| Check | Result |
|---|---|
| Role gating on `/activity` | rendered for Owner and Manager; refused for Accountant, Team Member, Viewer |
| Sidebar link | present for exactly those two roles |
| Header bell per role | 0 / 5 / 6 / 2 / 0 — matched the database exactly |
| Reassign a task | one `TASK_ASSIGNED` with a working deep link; **one** summary activity entry |
| Actor's own inbox | 0 — the "never notify yourself" rule, live |
| Mute `TASK_ASSIGNED`, reassign two tasks | tasks moved, activity written, **zero** notifications |
| Re-enable, reassign again | notification delivered — the mute is reversible |
| Mark read / unread / mark all | correct, and another user's count untouched |
| Forge another user's notification id | 303 back with the reason; row unchanged |
| Preferences form | 7 configurable checkboxes; `SYSTEM` absent entirely |
| `npm run job -- daily-recalculation` | `dueSoonNotices=2 overdueNotices=4` — matched the hand-computed set, with correct day counts and wording |
| Same job re-run | 0 and 0; no duplicates |
| Comment mentioning three people | two notified; the author's self-mention correctly ignored |
| Activity filters vs. SQL | entity type, action, SYSTEM actor, and no-match all matched exactly |
| Scheduled-job entries | 7 written, 7 selected by the filter, rendered as "Scheduled job" |
| Cross-tenant activity and notifications | no leak in either direction |
| Phases 0–10 screens | still 200 |

The test tenant was removed afterwards.

---

## 8. One correction made during this phase

Refusing a forged notification id initially surfaced as a generic **500**. The
codebase's convention since Phase 5 is that a refusal comes back as a readable
message rather than an opaque failure, so `setNotificationReadAction` now
redirects to `?error=` and the page renders the banner. Reaching it needs a
crafted request — the page only ever renders your own notifications — but a 500
tells the person nothing and looks identical to the server being broken.

---

## 9. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Unchanged from Phases 4–10.

**Resolved in Phase 14** for permission refusals — the check moved into `(app)/layout.tsx`, above the Suspense boundary that was committing the status. A record-level refusal still returns 200; see [`phase14-testing-security-deployment.md`](./phase14-testing-security-deployment.md) §1.

---

## 10. Not in this phase

- **`AuditLog` still has no screen.** The model and `logAudit` exist and are
  distinct from the user-facing `ActivityLog` (audit §15). Sign-in and export
  events are Phase 14's security work; adding a reader now would display an
  almost empty table.
- **No mention autocomplete**, as above.
- **No email or push delivery**, as above.
