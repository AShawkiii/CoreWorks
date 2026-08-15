# Phase 13 — Import & Export

**Status:** Complete
**Scope source:** [audit §17](./architecture-audit.md) — *"Phase 13 · Import/Export (CSV, Sheets migration path) · §14.3"*
**Specification:** [`migration-plan.md`](./migration-plan.md) §3–§6
**Builds on:** the display-ID formats and `IdSequence` from Phase 1 (including
`ensureSequenceAtLeast`, written then and documented as *"used after a CSV
import"*), the RBAC matrix from Phase 2 with its `data:import` / `data:export`
permissions, the legacy label tables from Phase 3, and every service and enum
from Phases 4–12.

---

## 1. Authoritative scope

Audit §17 assigns Phase 13 to **Import/Export (CSV, Sheets migration path)**,
depending on §14.3. The detailed specification is migration-plan §3–§6, which
is unusually precise for this phase — it names the eleven sheets, their order,
the per-column unmatched policy, and the four rules the import engine must
obey. This phase implements that document rather than a reading of it.

This is **not** a legacy port in the Phase 3 sense: legacy had no import or
export beyond *File → Download → CSV*. What it does port is the **contract** —
the exact column headers, the enumeration values, and the duplicate rules —
because migration-plan §3.2 makes them the interface:

> *"Legacy headers are the import contract. Every CSV header in audit §3.1 maps
> to a CoreWorks field; the importer matches on the **exact legacy header
> string**, so an unmodified export works with no hand-editing."*

---

## 2. The contract is checked against the legacy source

`src/lib/domain/legacy-schema.ts` transcribes the eleven header arrays from
`legacy/apps-script/config/Schemas.gs`. Because a well-meaning tidy-up here
would break every future import while every other test kept passing,
`tests/unit/legacy-schema.test.ts` **parses the legacy file** and compares.

That test also pins the strings most likely to be "fixed": `Active?` keeps its
question mark, `Typical Duration (Days)` its parentheses, `Days Waiting Bucket`
its existence, `P&L` its ampersand, and `Month-End Closing Date` the naming
that differs from the column it maps to.

`/legacy` is read as text only. It is never executed.

### Sheets deliberately absent

`CONTROL_CENTER`, `CLIENT_DASHBOARD`, `TEAM_DASHBOARD`,
`MONTHLY_CLOSE_DASHBOARD`, `MANAGEMENT_REPORT`, and `_CHART_SRC` are rendered
views, not data (migration-plan §3.1) — and they are equally absent from
`Schemas.gs`. Importing one would create records from a report. A test asserts
none of them is recognised as a sheet.

---

## 3. The four rules of the import engine

Migration-plan §4 states them; `src/server/services/import/engine.ts`
implements each once, rather than eleven times across the adapters.

| # | Rule | How |
|---|---|---|
| 1 | Nothing is written until Confirm; preview is a dry run over the real validators | Both passes run the **same code** in a transaction; the preview throws a sentinel to roll back |
| 2 | Per-row validation, not fail-fast | Parse failures and insert failures are both per-row |
| 3 | Every row lands in exactly one bucket | The loop has no uncounted path, and `assertBucketsSumToTotal` throws if the arithmetic disagrees |
| 4 | Whole file in one transaction | `prisma.$transaction` around the entire run |

Rule 1 is stronger than a validate-only preview: because the dry run executes
the actual inserts, it catches foreign keys and unique constraints that no
separate validator would know about. A test proves a preview and a commit of
the same file produce identical reports, row for row.

### The defect found while building this

Rules 2 and 4 are in direct tension, and the naive implementation silently
loses to it.

**PostgreSQL aborts the entire transaction on any error.** After one failed
statement, every subsequent command returns `25P02 current transaction is
aborted, commands ignored until end of transaction block`. So a
catch-the-error-and-continue loop inside one transaction does **not** skip one
bad row — it fails every row after it, with a message that names neither the
data nor the problem, while the report still looks like a plausible summary.

This surfaced live during the integration run: one employee row hit a
display-ID collision and the four rows after it failed with `25P02`.

**The fix is a `SAVEPOINT` per row.** Each insert runs inside one, released on
success and rolled back on failure, which gives per-row isolation *within* the
single file-level transaction — so both rules hold rather than being traded
off. The savepoint name is built from a loop counter, never from data.

Three tests pin it: that rows after a constraint violation still import, that
the reported reason is readable rather than a Prisma stack trace, and that a
preview still rolls the whole file back.

---

## 4. Dependency order (§3.3)

```
EMPLOYEES → SERVICES → SERVICE_PACKAGES → TASK_TEMPLATES → CLIENTS
          → TASKS → CLIENT_REQUESTS → ISSUES → MONTHLY_CLOSE → ACTIVITY_LOG → SETTINGS
```

The importer refuses an out-of-order file **as a file**. That is much kinder
than letting it through: a `TASKS` import run before `CLIENTS` would reject
every single row for an unresolvable client, which reads as corrupt data rather
than as a sequencing mistake.

`IMPORT_PREREQUISITES` is checked against `IMPORT_ORDER` by a test that asserts
the *property* — every prerequisite strictly precedes its dependant — rather
than only matching a literal list, so a future reordering has to satisfy the
rule.

---

## 5. Name resolution (§3.4), with a different policy per column

Legacy joined several relationships by display name (audit D4). Each resolves
to a real foreign key, and the plan specifies a **different** unmatched policy
per column — so they are not collapsed into one helper with one behaviour:

| Column | Unmatched | Why |
|---|---|---|
| `CLIENTS.Account Manager` | **Reject row** | Required by legacy `createNewClient`; every dashboard groups by it |
| `CLIENTS.Backup Team Member` | Warn, leave null | The client is still real |
| `TASKS.Assigned To` | Warn, leave unassigned | The work still has to be tracked; who does it can be fixed after |
| `ACTIVITY_LOG.Client` | Warn, **keep as text** | History about a departed client is still history |
| `MONTHLY_CLOSE.Client` | **Reject row** | A close with no client is meaningless |

> *"Unmatched names are listed individually in the import report — never
> silently dropped."*

Each is reported with a per-name occurrence count, so four tasks assigned to
one departed colleague produce one line reading `×4` rather than four lines or,
worse, none. A test covers each of the five policies individually.

People also resolve by **email** and clients by **display ID**, because a
legacy sheet holds either and a client may have been renamed since the export.

---

## 6. ID continuity (§3.5)

Legacy IDs are user-facing — staff cite `TSK-004321` in email (audit §4) — so
they are preserved verbatim, and the per-organization sequence is raised to the
**highest imported suffix** so new records continue the series.

Two details that a first implementation gets wrong:

- The high-water mark counts an ID on a **skipped** row too. The number is
  taken either way, so a counter that ignored duplicates would immediately mint
  a collision.
- A **malformed** ID is ignored rather than corrupting the sequence — the same
  tolerance legacy's `nextSequentialId` had.

**A collision is reported, never renumbered.** Importing into an organization
that already uses `EMP-001` is genuinely ambiguous: that is a different person.
Silently renumbering would break the one thing display IDs are for. A test
covers this explicitly, including that the non-colliding rows in the same file
still import.

---

## 7. Monthly Close reshaping (§3.6) — the one structural transform

`MONTHLY_CLOSE`'s 18 stage **columns** become 18 `MonthlyCloseTask` **rows**,
`stageOrder` preserving the legacy column order from
`MONTHLY_CLOSE_STAGE_COLUMNS = SCHEMAS.MONTHLY_CLOSE.slice(3, 21)`. Export
performs the inverse.

A blank stage cell becomes `Not Started` rather than being skipped — Phase 3's
**DIFF-1**. Legacy's `COUNTA` denominator counted only non-blank cells, so a
close where one stage had been touched read **100%**; materialising all
eighteen makes the denominator always eighteen.

`Close Status` and `Completion %` are **not** imported. A test imports a row
claiming `Closed` at `100%` with every stage untouched and asserts the close
reads `NOT_STARTED` at `0` — the engines produce the truth.

---

## 8. Derived columns are never imported (§3.2)

> *"Importing stored derived values would let a stale spreadsheet figure
> override a correct computation … which also serves as a live cross-check: if
> recomputed health disagrees with the spreadsheet's, that difference is a
> genuine finding to review, not something to paper over."*

Not imported: `Client Health`, `Simple Completion %`, `Weighted Completion %`,
`Last Activity`, `Next Deadline`, `Days Remaining`, `Days Overdue`,
`Days Waiting`, `Days Waiting Bucket`, close `Completion %` / `Close Status`.

One distinction worth stating because it is easy to get wrong in both
directions: the **task-level** `Completion %` **is** stored by legacy and is
imported. Only the client-level rollups are derived. A test asserts both.

They **are** exported, because export reproduces the legacy sheet and a sheet
without its computed columns is not that sheet — and they are recomputed at
export time rather than read from a stored copy, so the file is correct as of
the export rather than as of the last nightly pass.

---

## 9. Export (§6) — all eleven entities

> *"rollback means exporting CoreWorks to CSV and re-importing to Sheets —
> supported by the export system, which is why CSV export covers every entity,
> not just the convenient ones."*

An entity without an exporter is an entity you cannot roll back, so all eleven
are covered. Values are written with the **same label tables the importer
reads**, which makes a round trip exact by construction rather than by
coincidence: `Yes`/`No`, `YYYY-MM-DD`, and enum labels like `In Progress`
rather than `IN_PROGRESS`.

The round-trip suite exports every entity from one organization, imports it
into another, exports again, and compares column by column — nine entities,
every importable column.

### One defect found by live verification

The exported CSV carries a **byte-order mark**, which is the only thing that
stops Excel reading a UTF-8 CSV as the local 8-bit codepage and mangling every
non-ASCII character. The service emits it and an integration test asserts it.

**But the downloaded file did not have it.** Verified in a real browser: React's
flight serialization strips a leading U+FEFF from a string in transit — it is a
zero-width no-break space — so the payload reaches the client starting at `C`.
The download now re-attaches it, guarded so it cannot double up. Re-verified in
the browser: the downloaded file begins `EF BB BF`.

This was invisible to every server-side test, because the loss happens between
the server and the browser. It is exactly the class of defect that live
verification exists to catch.

---

## 10. CSV codec

Written rather than added as a dependency, for three reasons specific to
"whatever Google Sheets produced":

- **A BOM must be stripped on read.** Left in place, the first header reads
  `﻿Client ID`, matches nothing, and *every* column silently fails to map.
- **Quoting must round-trip exactly.** Legacy free-text carries commas, quotes,
  and newlines — `'Multi-location retailer, 4 storefronts.'` is real sample
  data.
- **Line endings vary.** Sheets emits CRLF; a file through an editor may be LF
  or CR. All three parse.

It also tracks the **original line number** per row, which diverges from the
row index as soon as a quoted field contains a newline — and the line number is
what the operator has to go and look at.

An unterminated quote consumes to end of file rather than rejecting the file:
900 good rows and one bad one is a far better outcome for a migration than
nothing.

---

## 11. Value parsing — never a silent coercion

> *"Enum values validate against audit §5. An unrecognized value is a
> rejection, never a silent coercion."*

Every parser returns `null` for anything unrecognised, and the engine turns
that into a **Failed** row naming the column and the value. Case and
surrounding whitespace are forgiven, because those are what a spreadsheet
changes by accident; nothing else is.

Two decisions worth recording:

- **Ambiguous date formats are refused.** `03/04/2026` is the 3rd of April in
  one locale and the 4th of March in another, and nothing in a CSV says which.
  Guessing would move deadlines by up to eleven months. Only `YYYY-MM-DD` (with
  an optional time) is accepted; dates are built in UTC so a due date does not
  shift a day on a server west of Greenwich. `2026-02-31` is rejected rather
  than rolled forward to March.
- **`Yes`/`No` also accepts `TRUE`/`FALSE` and `1`/`0`**, because a column that
  has had a checkbox applied exports those and the intent is unambiguous.
  Anything else is `null`, never `false` — returning `false` would silently
  deactivate every employee whose `Active?` cell was empty.

---

## 12. Permissions

**No new permission.** `data:import` (Manager and above) and `data:export`
(Team Member and above) have existed in the RBAC matrix since Phase 2.

The split is deliberate: an import writes records in bulk and is the most
consequential thing a non-admin can do to this data set; an export is a read.
A **Viewer holds neither** — a bulk extraction of the entire book of business
is a different act from reading one page of it — and does not see the nav entry
at all. The page renders only the halves the caller's role holds.

The nav entry is declared with `data:export`, the wider of the two, so a Team
Member who can export but not import still reaches it.

---

## 13. Database and schema

**No schema change and no migration.** Every table Phase 13 writes to already
existed, and `ensureSequenceAtLeast` was written in Phase 1 specifically for
this.

---

## 14. Tests

**2,766 tests pass** across 45 files. Phase 13 contributes 217: 128 unit
(31 CSV, 27 legacy-schema, 70 legacy-values) and 86 integration (57 import,
29 export), plus auto-generated action guards. Parity is unchanged at **1,670**.
The legacy suite is untouched at **110/111** — the one failure is the
pre-existing `webappTemplates` defect recorded as D1 in the Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/csv.test.ts` | BOM, CRLF/LF/CR, quoting, embedded newlines, original line numbers, short and long rows, unterminated quotes, header mapping including duplicates and reordering |
| `tests/unit/legacy-schema.test.ts` | The eleven header arrays **against `Schemas.gs` itself**, the stage-column slice, the derived-column list, and the dependency-order property |
| `tests/unit/legacy-values.test.ts` | Every enum label round-tripping to its own value; ambiguous dates, impossible dates, leap days; percentages as fraction, `45%`, and bare `45`; `Yes`/`No` and its variants |
| `tests/integration/import.test.ts` | All four rules, the savepoint isolation, idempotency per entity, dependency refusal, all five name-resolution policies, ID continuity, the close reshaping, derived columns, cross-tenant isolation, and 400- and 600-row files |
| `tests/integration/export.test.ts` | Exact headers for all eleven sheets, legacy value forms, recomputed derived columns, cross-tenant isolation on every sheet, and the full export → import → export round trip |

Edge cases covered explicitly: empty file; header-only file; a file that is not
the sheet it claims to be; extra and reordered columns; blank required dates;
malformed display IDs; a person already in another organization; an unknown
service in a package's free-text cell; and a display-ID collision.

---

## 15. Live verification

Against the production build and PostgreSQL, driven through a real browser
(Chromium) so the actual UI flow was exercised, not just HTTP.

**19/19 UI checks passed:**

| Check | Result |
|---|---|
| Preview of a 4-row file | `Preview · 4 rows read`, Imported 3 / Skipped 0 / Failed 1 |
| Preview says nothing saved | yes — and the database was unchanged |
| Preview names the bad line | `Line 5 SVC-204 — Active? must be Yes or No, not "perhaps".` |
| Commit | `Imported 3 rows.`, `Result · 4 rows read` |
| Re-run the same file | Imported 0 / Skipped 3 — idempotent |
| Out-of-order `TASK_TEMPLATES` | refused as a file: *"Import Service Packages first"* |
| Export download | `demo-meridian-clients.csv`, BOM present, CRLF, 10 rows |
| Exported header row | byte-identical to the 23 legacy `CLIENTS` headers |
| Viewer | sees neither form |
| Team Member | export form only |

**Additional HTTP checks:**

| Check | Result |
|---|---|
| Viewer / Team Member / Accountant commit an import | all refused with a permission message; member count unchanged at 5 |
| Viewer exports | refused |
| Realistic legacy `EMPLOYEES` file (BOM, CRLF, quoted comma) | 3 imported; `Handles retail, 4 accounts` preserved; `Active?=No` stored as false; `EMP-101/102/103` kept verbatim |
| ID sequence after import | raised to **103**, the highest imported suffix |
| Re-run | idempotent — member count unchanged |
| Mixed file: 1 duplicate, 2 invalid, 2 new | exactly +2 members; the two bad rows left nothing behind |
| Phases 0–12 routes (24 checked) | all still 200 |

**Independent SQL verification:** the downloaded `CLIENTS` CSV was compared
field by field against a hand-written SQL query joining `Client`,
`OrganizationMember`, and `User` — all 10 rows matched exactly on display ID,
name, company, start date, and account manager.

**Cross-tenant (11/11):** a second organization was created and driven through
the same UI. Its exports of `CLIENTS`, `TASKS`, `EMPLOYEES`, `ISSUES`, and
`ACTIVITY_LOG` contained none of the first tenant's client names or staff; and
a `TASKS` file naming the first tenant's client by both display ID and name was
refused rather than resolving across the boundary.

All probe data, the test tenant, and the imported records were removed
afterwards; the demo organization is back to its five seeded members.

---

## 16. Conflicts and findings

- **`Styles.html` drift (checked, none found).** Not a Phase 13 conflict, but
  the same class of question as §2: the legacy CSS exists in three copies with
  a warning that nothing keeps them in sync. Recorded in
  [`phase12-theming-branding.md`](./phase12-theming-branding.md) §1.
- **No legacy defect discovered in the import contract.** `Schemas.gs` is
  internally consistent and matches audit §3.1 exactly.
- **Two defects found in this phase's own work**, both described above: the
  PostgreSQL transaction-abort behaviour (§3) and the BOM lost in RSC transport
  (§9). Both are fixed and covered by tests.

---

## 17. Known rough edges, carried forward

- An unauthorized page request calls `notFound()`, which renders the not-found
  body but returns **HTTP 200** rather than 404. Unchanged from Phases 4–12.
- On the **no-JavaScript** progressive-enhancement path, a `useActionState`
  result is not carried into the re-render, so the import report is not shown.
  Verified against Phase 2's organization form to be identical framework
  behaviour predating this phase by eleven phases; the import itself is
  unaffected.
- The Workspace **"Team"** nav entry still carries a `phase: 9` badge although
  Phase 9 shipped `/team-dashboard` under Insights. It is a leftover
  placeholder, out of Phase 13's scope, and is noted here so it is not lost.

---

## 18. Not in this phase

- **No multi-file "import everything" wizard.** The plan specifies one sheet at
  a time in a stated order, and a single-file report is what makes a failure
  legible.
- **No Google Sheets API integration.** The audit is explicit that CoreWorks has
  no runtime dependency on Sheets; CSV is the interface.
- **`SETTINGS` and `ACTIVITY_LOG` are excluded from the round-trip comparison**
  — settings are seeded per organization so a target already has them, and
  activity is an append-only trail whose ids are organization-scoped.
- Testing, security hardening, and deployment are Phase 14.
