# Phase 12 — Theming & Branding

**Status:** Complete
**Scope source:** [audit §17](./architecture-audit.md) — *"Phase 12 · Theme/branding · §15"*
**Builds on:** the design tokens, `ThemeScript`, `ThemeToggle`, `Logo`, and the
`ThemeSettings` / `DashboardPreference` models laid down in Phase 1; the
`branding:manage` permission and settings shell from Phase 2; `logActivity`
from Phase 3; and the settings-page patterns from Phases 2 and 11.

Phase 12 finally reads two models that have sat in the schema, deliberately
unused, since Phase 1.

---

## 1. Is any of this a migration?

**No, and the audit says so explicitly.** Line 37 of the audit:

> | Theming / branding | **Absent** — hardcoded "Finance Lab", fixed palette | **Build net-new** (§15) |

Legacy had exactly one palette. It lived in `webapp/Styles.html` as CSS custom
properties — `--fl-brand: #1f2937`, `--fl-accent: #2563eb` — with no mechanism
to change them.

### The one legacy rule this phase exists to protect

Legacy separated two kinds of colour, and CoreWorks keeps them separate:

| Kind | Legacy | Phase 12 |
|---|---|---|
| **Chrome** — decoration | `--fl-brand`, `--fl-accent`, fixed | Per-organization |
| **Meaning** — state | `--fl-on-track`, `--fl-at-risk`, `--fl-delayed`, `--fl-on-hold`, mirroring the `colors` maps in `config/Enums.gs` | **Not brandable** |

Those state colours are not styling. The audit lists `Enums.gs` under
**canonical enumerations (§5)** — the same `#d4edda` / `#fff3cd` / `#f8d7da` /
`#e9ecef` drove the spreadsheet's conditional formatting *and* the web app's
badges. Green means on track.

So an organization whose brand colour is red must not end up with a red
"On Track" badge. `BRANDABLE_TOKENS` is the enforced boundary; three tests hold
it, including one that applies a fully red brand and asserts no `--health-*`,
`--success`, `--warning`, `--danger`, or `--info` token is emitted. Verified
live as well — see §8.

### Legacy's own copies, checked for drift

`Styles.html` carries a warning that it is **reference only**: the CSS is
inlined into `Index.html` and `AccessDenied.html`, with no build step keeping
the three in sync. That is exactly the situation where an authoritative copy
has to be established before anything is ported, so all three were compared:

| File | Tokens | Verdict |
|---|---|---|
| `Styles.html` | 17 | Complete definition |
| `Index.html` | 17, **identical values** | No drift |
| `AccessDenied.html` | 8, a strict subset, **identical values**, plus `--fl-danger` / `--fl-danger-bg` | No conflict — a standalone error page with no domain badges |

**No drift exists.** `Styles.html` is authoritative for the shared vocabulary;
`AccessDenied.html` adds two page-local tokens. Had they disagreed, the
inlined copies would have won, since those are what actually rendered.

---

## 2. What was built

| Route / module | Contents |
|---|---|
| `/settings/appearance` | Preset picker, five colour fields, logo, default mode, live preview, contrast report |
| `src/lib/domain/theme.ts` | Parsing, WCAG contrast, derivation, presets, the brandable boundary |
| `src/lib/validation/theme.ts` | The schemas — and the first of two XSS defences |
| `src/server/services/theme.ts` | Reads and writes both scopes |
| `src/server/actions/theme.ts` | Four actions across two different guards |
| `src/components/theme/theme-style.tsx` | Injects the brand into the initial HTML |
| `src/components/theme/theme-mode-sync.tsx` | Keeps the paint-time cache honest |

No schema change and no migration: `ThemeSettings` and
`DashboardPreference.themeMode` were already there.

---

## 3. Dark mode is derived, not authored twice

`ThemeSettings` stores five colours, authored for light. Dark needs different
values — the stock primary is `221 83% 53%` in light and `217 91% 62%` in dark,
because 53% lightness on a 9%-lightness page is too dim to read.

Asking an administrator to author every colour twice, and to get the dark
contrast right by eye, would produce worse results than computing it. So the
dark variant is derived, and **the rule is accessibility rather than taste**:
walk the lightness until the colour clears a WCAG floor against the surface it
sits on.

Two properties make that safe to automate:

- **Hue and saturation are never touched.** The hue is the part the
  organization actually chose; shifting it to win a contrast check would hand
  them a different colour from the one they asked for.
- **Foregrounds are chosen, not fixed.** Text on a fill is whichever of white
  or near-black contrasts better. A fixed white would be unreadable on a pale
  brand colour, which is precisely the case an administrator is most likely to
  pick and least likely to test.

A property test runs this across every preset and across all 21 lightness steps
from 0 to 100, asserting the floor is met from any starting point.

The page background is branded in **light mode only**. Tinting a 9%-lightness
dark page with a brand hue muddies every surface above it for no gain, and the
brand is already carried there by the sidebar and the primary.

---

## 4. Two scopes, kept apart

|  | Stored in | Guard | Scope |
|---|---|---|---|
| The organization's brand | `ThemeSettings` | `branding:manage` | Everyone in the tenant |
| A person's light/dark choice | `DashboardPreference` | authentication only | That person |

`DashboardPreference` is keyed on the **user alone**, not on the organization.
That is deliberate: light-versus-dark is about someone's eyes and their screen,
not about which tenant they are working in, so it follows them across
organizations while the brand does not. Verified live.

### Where the mode actually lives

The database is the source of truth; `localStorage` is a **cache**, and only
that. It exists because `ThemeScript` has to decide light-or-dark in `<head>`,
before any server data is available, or the page flashes white.

`ThemeModeSync` keeps the cache honest by writing the server's resolved answer
on every authenticated render. That is what makes the case a
write-once-and-forget design gets wrong come out right: **an administrator
changing the organization default reaches everyone who has never chosen**, not
only new browsers. There is a test for exactly that, and it was confirmed live
across four roles.

---

## 5. The stylesheet is an injection surface, and is defended twice

Brand colours are rendered into a `<style>` element. That is a full
page-defacement and data-exfiltration primitive if it can be escaped, so:

1. **The schema** accepts only three numeric HSL channels — `221 83% 53%`. Not
   `#hex`, not `rgb()`, not `red`, not `var(--danger)`, not anything with a
   brace, a semicolon, a comment marker, or `</style>`.
2. **The writer** re-serialises from the parsed **numbers**. `buildThemeCss`
   never echoes a stored string, so a value that reached the database by some
   other route still cannot carry anything out of its declaration.

Either alone would do. Both, because the second costs one function call.

The read path re-validates per slot as well: a corrupt stored colour falls back
to the CoreWorks default for that slot **without discarding the good values
beside it**, which is the difference between one wrong colour and a reset
nobody asked for.

Twelve payloads are asserted rejected at the schema, seven more at the domain
parser, and six were submitted through the real HTTP action — see §8.

The logo reuses Phase 2's `logoUrlSchema`, which already requires `https://`,
so a logo can never be a `javascript:` or `data:` URI.

---

## 6. Permissions

**No new permission was introduced.** `branding:manage` has existed since
Phase 2 and is held by Owner and Admin.

One decision worth recording: the nav entry was declared with
`permission: "branding:manage"` in Phase 1's placeholder, and this phase
changed it to `org:view`. Reading the palette is part of reading the
organization, and the page carries an explanation of which colours branding
deliberately leaves alone — a Manager benefits from seeing that even though
they cannot edit. Editing is still `branding:manage`, checked in the page for
the control and again in every action for the write. Verified live across all
five demo roles: the page rendered for all five, the Save control for the Owner
only, and four non-Owner roles were refused server-side with the database
unchanged.

---

## 7. Tests

**2,549 tests pass** across 40 files. Phase 12 contributes 110: 50 domain,
27 validation, 33 integration. Parity is unchanged at **1,670**. The legacy
suite is untouched at **110/111** — the one failure is the pre-existing
`webappTemplates` defect recorded as D1 in the Phase 0 audit.

| File | Covers |
|---|---|
| `tests/unit/theme.test.ts` | Channel parsing including 7 injection payloads; WCAG luminance against reference values; foreground selection at every lightness; contrast derivation from any starting point; the brandable boundary; stable, balanced CSS output; mode resolution |
| `tests/unit/validation-theme.test.ts` | 12 injection payloads at the schema; per-field rejection; the `https`-only logo rule; that `applyPresetSchema` refuses the `custom` marker |
| `tests/integration/theme.test.ts` | Both scopes against a real database: the missing-row and corrupt-value cases, idempotency, activity logging, preset application, reset, per-user modes, the organization default reaching existing users, cross-tenant isolation, and the system-context refusal |

Edge cases covered explicitly: an organization with **no** `ThemeSettings` row;
a corrupt stored colour; a corrupt stored mode; an unknown preset id; an
entirely empty brand; a repeat save that changes nothing; a scheduled run with
no user id.

---

## 8. Live verification

Against the production build and PostgreSQL with the demo seed.

| Check | Result |
|---|---|
| Role matrix on `/settings/appearance` | rendered for all five roles; Save control for Owner only |
| Viewer / Member / Accountant / Manager submit | all refused, `ThemeSettings` unchanged |
| Owner submit | saved; `preset=forest`, `primaryColor=158 64% 30%` |
| Brand reaches the initial HTML | `<style id="coreworks-brand">` present with 16 derived tokens |
| Unauthenticated `/login` | **no** brand block — the tenant is unknown before sign-in |
| **Every derived value re-checked independently** | 8/8 contrast floors passed under a separate Python/`colorsys` WCAG implementation — see below |
| 6 XSS payloads through the real action | all rejected; theme unchanged; rendered page clean |
| 3 logo payloads (`javascript:`, `data:`, `http:`) | all rejected |
| Personal mode set by Tomas | stored, rendered `dark`; nobody else affected |
| Org default set to `dark` | four roles who never chose all moved to dark |
| Helen overrides to `light` | hers alone; org default still `dark` |
| Cross-tenant | each tenant saw only its own palette; neither colour appeared on the other's page; a rival save touched only their own row |
| `Theme Changed` activity | 2 entries for one tenant, 1 for the other — correctly scoped |
| Viewer reset attempt | refused, palette unchanged |
| Owner reset | back to `coreworks`; the style block disappears entirely |
| **Red brand vs. client health** | chrome went red; all four `bg-health-*` classes intact; zero health tokens in the brand block |
| Phases 0–11 routes (23 checked) | all still 200 |

Independent verification of the derived tokens, computed from the rendered HTML
with a separate implementation rather than the application's own:

```
light primary vs its foreground              5.06:1  PASS (>= 4.5)
light secondary vs its foreground            4.79:1  PASS (>= 4.5)
light accent vs its foreground               4.95:1  PASS (>= 4.5)
sidebar vs sidebar text                     13.11:1  PASS (>= 4.5)
sidebar vs sidebar muted                     7.42:1  PASS (>= 3.0)
dark primary vs dark page                    3.68:1  PASS (>= 3.0)
dark primary vs its foreground               5.06:1  PASS (>= 4.5)
dark sidebar vs dark sidebar text           15.22:1  PASS (>= 4.5)
```

The test tenant was removed and the demo palette reset afterwards.

---

## 9. Behaviours preserved deliberately

- **The stock palette emits nothing at all.** An organization that never opens
  this screen renders byte-identical HTML to every phase before it — no style
  block, no override. `isDefaultBrand` is what makes that true, and a test
  pins the `coreworks` preset to the exact values in `globals.css`.
- **The logo lives on `Organization`, not on `ThemeSettings`.** It is identity
  rather than palette. This screen is where it is edited; `resetThemeSettings`
  therefore leaves it alone, because "reset the colours" is not "delete our
  logo".
- **Editing a colour switches the preset to `custom`.** Continuing to claim a
  named preset the palette no longer matches would be a lie the form tells on
  every reopen.
- **A repeat save writes no activity entry.** The same rule the health engine
  follows: a recalculation that changes nothing is not an event.

---

## 10. One pre-existing behaviour observed, not introduced

Submitting an invalid colour through the **no-JavaScript** progressive-
enhancement path re-renders the page without the field error, because
`useActionState` state is not carried into a non-action re-render. This was
checked against Phase 2's organization form on the identical path and behaves
the same way, so it is framework behaviour affecting every form in the
application since Phase 2 — not something Phase 12 introduced. The rejection
itself is unaffected: nothing invalid is ever stored. With JavaScript enabled,
which is the real path, the field error renders normally.

---

## 11. Known rough edge, carried forward

An unauthorized page request calls `notFound()`, which renders the not-found
body but returns **HTTP 200** rather than 404. Unchanged from Phases 4–11.

**Resolved in Phase 14** for permission refusals — the check moved into `(app)/layout.tsx`, above the Suspense boundary that was committing the status. A record-level refusal still returns 200; see [`phase14-testing-security-deployment.md`](./phase14-testing-security-deployment.md) §1.

---

## 12. Not in this phase

- **No custom fonts or spacing.** `--radius` and the type scale stay fixed;
  branding here is colour and logo, which is what audit §15 names.
- **No logo upload.** The field takes an `https` URL. File storage arrives with
  attachments; inventing a one-off uploader for logos would be a parallel
  pattern of exactly the kind this migration avoids.
- **No per-user brand override.** The brand is the organization's; only
  light/dark is personal.
- Import/export is Phase 13.
