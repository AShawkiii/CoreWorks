# CoreWorks — Migration Plan

**Companion to:** [`architecture-audit.md`](./architecture-audit.md) — read that first. This document covers *moving the data and the logic*; the audit covers *what exists*.

**Scope:** Google Sheets + Apps Script (Finance Lab V1) → CoreWorks SaaS on PostgreSQL.
**Non-goal:** CoreWorks must have **no runtime dependency** on Google Sheets, Apps Script, or `clasp` (master prompt §55). Sheets remains an optional *import/export* format only.

---

## 1. Two migrations, not one

These are independent and must not be conflated:

| | **Logic migration** | **Data migration** |
|---|---|---|
| Moves | 24 `*Logic.gs` / engine files | Rows from 11 sheets |
| Method | Port to TypeScript, prove with parity tests | CSV export → validate → import |
| Risk | Silent behavior drift | Bad/incomplete records |
| Guard | Legacy test suite ported to Vitest | Import preview + rejection report |
| Phase | 3 | 13 |

Logic migrates **first**. Data import is built against already-proven rules, so an import can never define behavior by accident.

---

## 2. Logic migration

### 2.1 Why this is a port, not a rewrite
The legacy author separated every engine into a pure `*Logic.gs` (no `SpreadsheetApp`) and an I/O `*Service.gs`. The pure files are plain JavaScript with no platform coupling — they become TypeScript with type annotations and little else. See audit §14.1 for the full function-by-function map.

### 2.2 Procedure, per module
1. Copy the pure function into its CoreWorks target path.
2. Add types. **Do not restructure**, rename, or "improve" logic.
3. Port the module's legacy test file to Vitest, changing only imports and syntax — **never assertions or expected values**.
4. Run. A failure means the port is wrong, not the test.
5. Only then wire it into a repository/service.

### 2.3 Parity gate
Phase 3 exits when **all 110 passing legacy business-logic assertions pass against the TypeScript ports**. The 111th (`webappTemplates.test.js`) is intentionally dropped — it tests Apps Script HTML templates that CoreWorks replaces, and it documents legacy defect D1.

### 2.4 Deliberate deviations
Only three, each with justification recorded in the audit:

| Change | Reason |
|---|---|
| ID generation: scan-max → DB sequence | Audit D3 — scan-max races under concurrency. **Format preserved.** |
| Name-based FKs → real FKs | Audit D4 — renames orphan history |
| `CURRENT_USER` from session, not template | Audit D1 — legacy bug, not reproduced |

Everything else ports unchanged. Any further deviation requires an entry in `business-rules.md` explaining what changed and why.

---

## 3. Data migration

### 3.1 Export from Sheets
Per sheet: **File → Download → CSV**, or `Finance Lab → Export` if present. Export these 11 in this order (order matters — see §3.3):

```
EMPLOYEES, SERVICES, SERVICE_PACKAGES, TASK_TEMPLATES, CLIENTS,
TASKS, CLIENT_REQUESTS, ISSUES, MONTHLY_CLOSE, ACTIVITY_LOG, SETTINGS
```

Dashboard sheets (`CONTROL_CENTER`, `CLIENT_DASHBOARD`, `TEAM_DASHBOARD`, `MONTHLY_CLOSE_DASHBOARD`, `MANAGEMENT_REPORT`, `_CHART_SRC`) are **rendered views, not data** — do not export them. CoreWorks regenerates all of it.

### 3.2 Column mapping
Legacy headers are the import contract. Every CSV header in audit §3.1 maps to a CoreWorks field; the importer matches on the **exact legacy header string**, so an unmodified export works with no hand-editing.

Columns deliberately **not** imported (recomputed from source data on first recalculation pass):

`Days Remaining` · `Days Overdue` · `Days Waiting` · `Days Waiting Bucket` · `Simple Completion %` · `Weighted Completion %` · `Client Health` · `Next Deadline` · `Last Activity` · Monthly Close `Completion %` / `Close Status`

> Importing stored derived values would let a stale spreadsheet figure override a correct computation. They are imported as *nothing* and produced by the engines — which also serves as a live cross-check: if recomputed health disagrees with the spreadsheet's, that difference is a genuine finding to review, not something to paper over.

### 3.3 Dependency order
Referential integrity requires this sequence. The importer enforces it and refuses out-of-order files:

```
Organization (created first, manually)
  └─ Users / OrganizationMembers      ← EMPLOYEES
  └─ Services                         ← SERVICES
       └─ ServicePackages             ← SERVICE_PACKAGES
            └─ TaskTemplates          ← TASK_TEMPLATES
                 └─ Clients           ← CLIENTS          (needs package + account manager)
                      ├─ Tasks        ← TASKS
                      ├─ ClientRequests ← CLIENT_REQUESTS
                      ├─ Issues       ← ISSUES
                      ├─ MonthlyClose ← MONTHLY_CLOSE    (18 stage cols → 18 rows)
                      └─ ActivityLog  ← ACTIVITY_LOG
OrganizationSettings                  ← SETTINGS
```

### 3.4 Resolving name-based references
Legacy joins several relationships by display name (audit D4). The importer resolves each to a real FK:

| Legacy column | Resolved against | If unmatched |
|---|---|---|
| `CLIENTS.Account Manager` | `User.name` | **Reject row** — required field |
| `CLIENTS.Backup Team Member` | `User.name` | Warn, leave null |
| `TASKS.Assigned To` | `User.name` | Warn, leave unassigned |
| `ACTIVITY_LOG.Client` | `Client.name` | Warn, keep as text |
| `MONTHLY_CLOSE.Client` | `Client.name` | **Reject row** |

Unmatched names are listed individually in the import report — never silently dropped.

### 3.5 ID continuity
Legacy IDs (`CL-0007`, `TSK-004321`) are **user-facing** — staff cite them in email and conversation. They are preserved as `displayId` alongside a UUID primary key. The per-organization sequence is initialized to the **highest imported suffix** so newly created records continue the series without collision.

### 3.6 Monthly Close reshaping
The one structural transform. `MONTHLY_CLOSE`'s 18 stage columns become 18 `MonthlyCloseTask` rows per close, each with `stageName`, `stageOrder` (preserving the legacy column order from `MONTHLY_CLOSE_STAGE_COLUMNS`), and `status`. `Completion %` and `Close Status` are then derived per audit §6.13, not imported.

---

## 4. Import engine

Per master prompt §40. One reusable engine, per-entity adapters.

```
Upload CSV → Parse → Map headers → Validate (Zod) → Preview → Confirm → Import (transaction) → Report
```

Rules:
- **Nothing is written until Confirm.** Preview is a dry run over the real validators.
- **Per-row validation**, not fail-fast: one bad row does not abort the file.
- **Every row lands in exactly one bucket** — Imported / Skipped (duplicate) / Failed (with reason + row number).
- **Duplicate detection reuses legacy rules** — e.g. clients dedupe on Client Name + Company Name (audit §6.9), tasks on the `clientId|serviceArea|taskName|period` key (audit §6.11). The importer is idempotent: re-running a file imports nothing new.
- **Whole file in one transaction.** Partial imports leave no half-migrated state.
- Enum values validate against audit §5. An unrecognized value is a rejection, never a silent coercion.

---

## 5. Cutover

Adapted from the legacy `future-architecture.md` §"Migration path", which anticipated this.

| Step | Action | Exit criterion |
|---|---|---|
| **1** | Stand up schema + seed org | Migrations apply cleanly |
| **2** | Port logic (Phase 3) | 110/110 parity tests pass |
| **3** | Import a **copy** of live data into staging | Import report: 0 unexplained failures |
| **4** | **Parallel run** — Sheets stays authoritative; compare CoreWorks dashboards against the live Control Center | KPIs and client health match, or every difference is explained |
| **5** | Freeze the Sheet (read-only), final re-import | Delta import clean |
| **6** | Cut over writes to CoreWorks | Users working in CoreWorks |
| **7** | Archive the Sheet | Retained read-only as historical record |

**Step 4 is the real safety net.** Two systems computing the same KPIs from the same data is the strongest available check that the logic port is faithful. Do not skip it, and do not shorten it to less than one full close cycle — the monthly generation and close paths only exercise once a month.

**Rollback:** through step 5 the Sheet remains authoritative and canonical; rollback is simply "keep using the Sheet." After step 6, rollback means exporting CoreWorks to CSV and re-importing to Sheets — supported by the export system (master prompt §41), which is why CSV export covers every entity, not just the convenient ones.

---

## 6. Export

Every importable entity is also exportable to CSV, using the **same legacy headers**. This gives round-tripping, the post-cutover rollback path, and continuity for staff who still want a spreadsheet — without CoreWorks depending on one.

---

## 7. Decommissioning Google

After cutover:

| Artifact | Disposition |
|---|---|
| Apps Script project | Disable triggers, unpublish Web App, keep the project read-only for reference |
| Spreadsheet | Read-only archive |
| `clasp` / `.clasp.json` | Not used by CoreWorks |
| OAuth scopes | Revoked |
| `/legacy` in this repo | **Retained permanently** as the business-rules reference (master prompt §65) |

CoreWorks has **zero** Google dependencies at runtime: no Apps Script, no Sheets API, no Google auth requirement. Sheets is one supported CSV shape among others.

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Logic drift during port | Wrong health/KPIs; silent | Parity tests (§2.3); verbatim porting rule |
| Unmatched employee/client names | Orphaned assignments | Explicit per-name reporting (§3.4) |
| Stale derived values imported | Wrong dashboards | Derived columns not imported (§3.2) |
| ID collision after cutover | Duplicate `TSK-` refs | Sequence seeded from max imported (§3.5) |
| Concurrency race on ID generation | Duplicate IDs | DB sequence replaces scan-max (audit D3) |
| Monthly paths untested at cutover | Generation/close breaks in production | Parallel run spans ≥1 full close cycle (§5) |
| Data loss during cutover | Severe | Sheet authoritative until step 5; frozen before final import |
