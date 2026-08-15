# Database

PostgreSQL via Prisma 7. Schema: [`prisma/schema.prisma`](../prisma/schema.prisma).
Every model traces to the Phase 0 audit; deviations are marked `DEVIATION:` in
the schema with a reason.

**Current state:** 29 application tables, 16 enums, one migration
(`20260815120341_init`).

## Multi-tenancy

Every business table carries `organizationId`.

- Uniqueness is **always scoped by organization** — `@@unique([organizationId, displayId])`, never a bare unique. Two organizations can each own `CL-0001`.
- Deleting an organization cascades to all of its data.
- Scoping is enforced in application code through `src/server/tenancy.ts`, which derives `organizationId` from the session and never from request input.

Row-level security is a later hardening step (see `security.md` when Phase 13
lands); it is defence in depth, not a replacement for the scoping above.

## Identity

Legacy `EMPLOYEES` is split in two, because a person and their role in an
organization are different things:

| | Holds |
|---|---|
| `User` | Global identity — name, email, password hash, sessions |
| `OrganizationMember` | Membership — RBAC role, job title, capacity, active flag |

This is what makes one person able to belong to several organizations with a
different role in each.

Two distinct notions of "role" coexist deliberately:

- `OrganizationMember.role` — the **RBAC role** (Owner … Viewer). Governs access. **Net-new**; legacy had no equivalent (audit §10).
- `OrganizationMember.jobTitle` — the **legacy `EMPLOYEES.Role`** (Bookkeeper, Senior Accountant, FP&A Analyst …). Drives template assignee resolution (audit §6.10) and is never an access-control input.

Auth.js supplies `Account`, `Session`, and `VerificationToken`.
`PasswordResetToken` stores only a SHA-256 hash of the token.

## Display IDs

Legacy IDs are user-facing (audit §4), so every entity carries both a UUID
primary key and a `displayId` in the original format:

| Entity | Format |
|---|---|
| Client | `CL-0001` |
| Member | `EMP-001` |
| Task | `TSK-000001` |
| Task template | `TPL-001` |
| Client request | `REQ-0001` |
| Issue | `ISS-0001` |
| Activity | `ACT-0000001` |
| Service | `SVC-001` |
| Service package | `PKG-001` |
| Monthly close | `MC-CL-0007-202608` |

Allocation goes through `IdSequence`, one counter per (organization, entity),
incremented atomically. Legacy scanned for the highest existing suffix and
added one — correct single-threaded, a duplicate-ID race under concurrency
(audit D3). The format is preserved; only the mechanism changed.

## Normalization beyond the spreadsheet

| Legacy | CoreWorks | Why |
|---|---|---|
| `SERVICE_PACKAGES."Included Service Areas"` (free text) | `ServicePackageService` join | Queryable; no string parsing |
| `CLIENTS` single contact columns | `ClientContact` rows (legacy columns retained) | Clients have more than one contact |
| `MONTHLY_CLOSE` 18 stage **columns** | `MonthlyCloseTask` 18 **rows** | Per-stage assignee, timestamps, notes |
| Name-based references | Real foreign keys | Renaming a client no longer orphans its history (audit D4) |

`MonthlyCloseTask.stageOrder` preserves the original column order so the close
view renders as before.

## Stored vs derived

Legacy split these between live spreadsheet formulas and script-written values
because Sheets could not be trusted to recompute aggregates. CoreWorks computes
everything server-side, so the distinction is now purely about caching.

**Derived on read** — never stored:
`Days Remaining` · `Days Overdue` · `Days Waiting` · `Days Waiting Bucket` ·
monthly-close `Completion %` and `Close Status`

**Stored, recomputed on change** — because they are sorted and filtered across
the whole client list:
`Client.health` · `Client.simpleCompletionPct` · `Client.weightedCompletionPct` ·
`Client.nextDeadline` · `Client.lastActivityAt`

Percentages are stored as fractions in `0..1`, matching legacy (audit §6.2).

## The task dedupe key

Legacy skipped generating a task when
`clientId | serviceArea | taskName | period` already existed (audit §6.11).
That is modelled as an **index, not a unique constraint** — deliberately.

Legacy consults the key only inside the generators; manual ad-hoc creation
never checks it, and may legitimately repeat a task name within a period. A
unique constraint would be stricter than the system it replaces. The check
stays in the generation service, where legacy put it.

## Audit trails

Two tables, on purpose:

- **`ActivityLog`** — the legacy business trail (audit §6.14). What users see: client added, task status changed, health changed. Carries a `userEmail` snapshot so history survives user deletion.
- **`AuditLog`** — net-new security/technical trail: sign-ins, permission changes, exports, settings changes, with IP and user agent.

## Soft deletion

`deletedAt` on `Organization`, `User`, `OrganizationMember`, `Client`,
`ClientContact`, `Service`, `ServicePackage`, `TaskTemplate`, `Task`, `Issue`,
`ClientRequest`, `MonthlyClose`, `Comment`, and `Attachment`. Queries must
filter `deletedAt: null`. Junction and log tables are hard-deleted or
cascade-deleted.

## Indexes

Beyond primary and foreign keys, indexes follow the queries the dashboards
actually run (audit §8): `organizationId` on every business table, plus
`status`, `dueDate`, `health`, `contractStatus`, `period`, assignee, and
`(clientId, status)` composites, and `deletedAt` where soft deletion is
filtered on every read.

## Migrations

```bash
npm run db:migrate           # create + apply (development)
npm run db:deploy            # apply only (CI/production)
npm run db:reset             # drop, re-migrate, re-seed — destructive
```

Migrations are committed and applied in order. Never edit an applied
migration — add a new one.
