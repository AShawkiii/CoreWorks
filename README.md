# CoreWorks

Client management and financial operations platform for finance, accounting, and consulting teams.

CoreWorks answers, at a glance: which clients are on track, at risk, or delayed; what work is overdue; what is waiting on the client; who owns what; how the team is loaded; and where month-end close stands — across every client.

---

## Repository status

| Phase | Scope | Status |
|---|---|---|
| **0** | Repository audit, legacy preservation, migration plan | ✅ **Complete** |
| **1** | Project scaffold, database schema, authentication, design tokens | ✅ **Complete** |
| **2** | Organization, users, roles, permissions, app shell | ✅ **Complete** |
| **3** | Business-logic port + differential parity suite + Control Center | ✅ **Complete** |
| **4** | Clients module — list, create, detail, edit, archive, contacts | ✅ **Complete** |
| **5** | Tasks module — list, detail, edit, bulk operations, comments | ✅ **Complete** |
| **6** | Issues and Client Requests | ✅ **Complete** |
| **7** | Control Center — the 14 KPIs and their drill-downs | ✅ **Complete** |
| **8** | Client Dashboard | ✅ **Complete** |
| **9** | Team Dashboard and Management Report | ✅ **Complete** |
| **10** | Monthly Close, template catalog, scheduled generation jobs | ✅ **Complete** |
| **11** | Activity Log and Notifications | ✅ **Complete** |
| **12** | Theming, branding, and appearance | ✅ **Complete** |
| 13 | Import/export (CSV, Sheets migration path) | Next |
| 14 | Testing, security, deployment | Pending |

Full sequencing: [`docs/architecture-audit.md` §17](docs/architecture-audit.md).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL 16 ·
Prisma 7 · Auth.js v5 · Zod 4 · Vitest · Recharts · Lucide

See [`docs/setup.md`](docs/setup.md) to run it locally, and
[`docs/database.md`](docs/database.md) for the data model.

---

## Origin

CoreWorks is the successor to an internal Google Sheets + Google Apps Script system (7,852 LOC). That system is the **business-rules source of truth** and is preserved verbatim in [`/legacy`](./legacy).

The legacy codebase was deliberately built with every business rule in a pure, dependency-free `*Logic.gs` module, separate from its spreadsheet I/O — explicitly so the rules could later move to a real backend. CoreWorks is therefore a **port of proven logic**, not a reimplementation.

Nothing in `/legacy` is executed by CoreWorks. It is reference material and must not be deleted (see the audit for the rule-by-rule mapping).

**CoreWorks has no runtime dependency on Google Sheets, Apps Script, or `clasp`.** Sheets is supported only as an optional CSV import/export format.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/architecture-audit.md`](docs/architecture-audit.md) | **Start here.** Full audit of the legacy system: modules, entities, enumerations, every business rule with citations, dashboards and KPIs, permissions, known defects, and the function-by-function migration map. |
| [`docs/migration-plan.md`](docs/migration-plan.md) | Logic port procedure, Sheets → PostgreSQL data migration, import engine, cutover and rollback. |
| [`docs/setup.md`](docs/setup.md) | Requirements, environment variables, database setup, commands, troubleshooting. |
| [`docs/database.md`](docs/database.md) | Schema design: multi-tenancy, identity split, display IDs, normalization, stored vs derived fields. |
| [`docs/architecture.md`](docs/architecture.md) | Application layering, module map, server/client boundary, design tokens, extensibility. |
| [`docs/security.md`](docs/security.md) | Authentication, the role matrix, tenant isolation, validation, audit trails, and what is not yet implemented. |
| [`docs/phase3-business-logic.md`](docs/phase3-business-logic.md) | Every migrated legacy rule, its destination, parity status, known differences, and the tests covering it. |
| [`docs/phase4-clients.md`](docs/phase4-clients.md) | The Clients module: what it consumes from Phase 3, list behaviours, the one deviation, security, and tests. |
| [`docs/phase5-tasks.md`](docs/phase5-tasks.md) | The Tasks module: the status-change sequence, bulk semantics, the two-layer edit permission, and live verification results. |
| [`docs/phase6-issues-requests.md`](docs/phase6-issues-requests.md) | Issues and Client Requests: why neither has a state machine, the resolve/receive stamps, request ageing, and live verification results. |
| [`docs/phase7-control-center.md`](docs/phase7-control-center.md) | The Control Center: the 14 KPIs, how each drill-down is proven to match its number, and the two legacy behaviours now stated on the page. |
| [`docs/phase8-client-dashboard.md`](docs/phase8-client-dashboard.md) | The Client Dashboard: the seven sections and their two different scopes, and a conflict between legacy's own two task-sort implementations. |
| [`docs/phase9-team-management.md`](docs/phase9-team-management.md) | Team Dashboard and Management Report: the workload rules, the four report sections, and the audit D4 fix to how assignments are matched. |
| [`docs/phase10-close-templates-jobs.md`](docs/phase10-close-templates-jobs.md) | Monthly Close, the template catalog, and the scheduled jobs: two completion figures, the blank-stage trap, and why the daily recalculation is necessary rather than convenient. |
| [`docs/phase11-activity-notifications.md`](docs/phase11-activity-notifications.md) | The Activity Log and Notifications: why one is a reader over ported rules and the other is net-new, the four delivery rules, and the three kinds of actor an entry can have. |
| [`docs/phase12-theming-branding.md`](docs/phase12-theming-branding.md) | Theming and branding: which colours an organization may change and which carry meaning it must not, how dark variants are derived rather than authored twice, and the two defences around the injected stylesheet. |

`deployment.md` arrives with Phase 14.

---

## Key business rules

Defined in the legacy system, cited in the audit, and preserved exactly. Summarized here because they drive nearly every screen:

- **Client Health** — `On Hold` (hard override) → `Delayed` (any Critical overdue task, ≥3 overdue tasks, or any open Critical issue) → `At Risk` (≥1 overdue task, a Critical/High task due within 3 days, or any open High issue) → `On Track`. Thresholds are per-organization settings.
- **Weighted Completion %** — tasks count by priority weight (Critical 4, High 3, Medium 2, Low 1) over all non-cancelled tasks. Simple Completion % uses the same population, unweighted.
- **Task status machine** — 7 statuses with enforced transitions. `Not Started → Completed` is not allowed; `Cancelled` is terminal. Issues and requests deliberately have **no** such machine — legacy validated transitions only on tasks.
- **Issue surfacing** — open Critical/High issues, or any open issue past its deadline; sorted most severe, then oldest.
- **Task generation** — recurring work expands from Service Package templates, deduplicated on `client|serviceArea|taskName|period`, so generation is always safe to re-run and never rewrites history.

See [audit §6](docs/architecture-audit.md) for the authoritative statements with source citations, and
[`docs/phase3-business-logic.md`](docs/phase3-business-logic.md) for how each one was migrated and proven.

All of these are now ported to TypeScript and verified against the original
Apps Script implementation by 1,670 differential assertions — the legacy code
is loaded into the test process and run side by side with the port.

---

## Local development

```bash
npm install
cp .env.example .env      # set DATABASE_URL and AUTH_SECRET
npm run db:migrate
npm run db:seed           # optional demo organization
npm run dev
```

Two scheduled jobs replace the legacy Apps Script triggers (audit §9).
They have no built-in scheduler — point cron, a platform scheduler, or a
workflow at them:

```bash
npm run job -- daily-recalculation   # cron: 0 2 * * *
npm run job -- monthly-generation    # cron: 0 3 1 * *
npm run job -- monthly-generation 2026-09
```

Both are safe to re-run and both sweep every organization. The runner exits
non-zero if any tenant failed, so a partial run cannot look like success.

The daily pass also sends due-soon and overdue reminders, for the same reason
it recalculates health: a deadline passes because the date rolled over, not
because anyone edited anything. Re-running it the same day sends nothing twice.

Full instructions, including PostgreSQL setup and troubleshooting, are in
[`docs/setup.md`](docs/setup.md).
