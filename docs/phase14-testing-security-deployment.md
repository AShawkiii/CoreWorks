# Phase 14 — Testing, security, deployment

Audit dependency §11. The last phase in the plan
([audit §17](./architecture-audit.md)).

Every earlier phase left something in `security.md` under *"Not yet
implemented"*, and several left a status-code defect in a "known issues"
paragraph. This phase is where those come due — not by declaring them done,
but by closing the ones that can be closed and stating precisely what remains
for the ones that cannot.

---

## What this phase inherits

| From | What it depends on |
|---|---|
| Phase 1 | Auth.js credentials provider, the Prisma schema, `src/proxy.ts` middleware |
| Phase 2 | The 32-permission matrix, `getOrgContext()`, the uniform sign-in failure |
| Phase 4–13 | `NAV_SECTIONS` / `SETTINGS_NAV`, which every screen's route and permission are declared in |
| Phase 11 | `logAudit()` and the `AuditLog` table, written but never read |
| Phase 12 | `ThemeScript` / `ThemeModeSync` — the two hand-authored `<script>` tags CSP had to accommodate |
| Phase 13 | The import/export actions, which now write audit entries |

Nothing in `/legacy` covers any of this. Legacy had one access rule and no
transport security at all (audit §10), so this is new construction, and the
only legacy property carried forward is that it failed **closed**.

---

## 1. The `notFound()` status code — measured, then half fixed

This was the oldest open defect in the repository, carried in seven phase
documents since Phase 4:

> *An unauthorized page request calls `notFound()`, which renders the not-found
> body but returns HTTP 200 rather than 404.*

Every document repeated it; none had established **why**. So the first thing
this phase did was measure.

| Case | Status before |
|---|---|
| A genuinely unknown path | 404 — correct all along |
| A permission refusal in a page | 200 |
| A record that belongs to another organization | 200 |

Unknown paths being correct pointed at something between the request and the
page. The suspect was `src/app/(app)/loading.tsx`: a Suspense boundary flushes
the shell — and commits the status line — before the page component runs, so a
later `notFound()` can replace the body but not the status.

Two experiments settled it. **Removing `loading.tsx`** made both failing cases
return 404, confirming the cause. **Adding a probe to the layout**, which runs
above the boundary, returned 404 with `loading.tsx` still in place — which
meant the choice was not the either/or the earlier documents had assumed.

### The fix

`src/server/auth/route-permissions.ts` derives a route → permission map from
`NAV_SECTIONS` and `SETTINGS_NAV` — the same declarations the sidebar renders
from — and `(app)/layout.tsx` refuses there, above the boundary.

Deriving it rather than restating it is the point. A hand-written second table
would drift from the sidebar, and a route that is hidden but reachable is
worse than one that is neither. The map also throws at module load if two
menus declare the same route with **different** permissions, because that
would mean the sidebar and the guard disagree and silently taking the first
would hide it. (`/settings/organization` is declared twice with the *same*
permission, which is legitimate and collapses to one entry.)

The pages keep their own checks. This is a second gate in front of them.

### What is still 200

Only the **permission** half closed. A **record-level** refusal — this client
belongs to another organization — still returns 200 with the not-found body.
Verified live, signed in as an Owner of one organization against another
organization's records:

| Request | Status | Body |
|---|---|---|
| `/clients/<other org's id>` | 200 | not-found page, no client data |
| `/clients/<other org's id>/edit` | 200 | not-found page, no form, no values |
| `/tasks/<other org's id>` | 200 | not-found page, no task data |
| `/tasks/<other org's id>/edit` | 200 | not-found page, no form, no values |
| `/clients/<id that exists nowhere>` | 200 | not-found page |

Each response was searched for the other organization's client and task names
and contained neither, so this remains what it always was: a status-code
defect, not a leak.

It cannot be fixed the same way, and the reason is structural rather than an
oversight. Route permission is decidable **from the path**, which is why it
could move above the Suspense boundary. Whether a record exists *in this
tenant* needs a database read, which can only happen in the page — below the
boundary that has already committed the status. Moving the boundary lower does
not help: a `loading.tsx` in `/clients` still sits above `/clients/[id]`, so
the only arrangement that fixes detail pages is one where they have no
skeleton at all.

The remaining choice is therefore genuine: keep the streamed skeleton on every
page and accept 200 on record-level refusals, or delete `(app)/loading.tsx`
and lose the skeleton everywhere. CoreWorks keeps the skeleton. Both were
measured before choosing.

---

## 2. Rate limiting

`security.md` had carried this since Phase 2. Two endpoints, limited for two
different reasons:

| Endpoint | Budget | Reason |
|---|---|---|
| Sign-in | 5 / 15 min per account | Slow password guessing |
| Password reset | 3 / hour per address | Each accepted request is meant to put mail in an inbox, so an unlimited form is a way to flood a real person |

The arithmetic is pure (`src/lib/domain/rate-limit.ts`) and the storage is
separate (`src/server/services/rate-limit.ts`), which is what makes every
boundary testable without waiting or mocking a clock.

Five decisions carry weight, and each has a test pinning it:

**Stored in PostgreSQL.** A per-process counter gives an attacker one budget
per instance, and any deployment runs more than one. The integration test
asserts the row exists, not merely that the decision came out right.

**Checked before bcrypt.** bcrypt at cost 12 is deliberately slow, so checking
the limit first is also what stops a flood becoming CPU exhaustion.

**A refused attempt counts, but never extends the window.** Counting it means
continuing to hammer extends the attacker's own lockout instead of idling
until the window rolls. Keeping the original window start means the lockout
ends on schedule, so a third party cannot hold somebody locked out
indefinitely.

**Keyed on the account.** Auth.js `authorize` has no request object, and an
attacker rotating IPs through a proxy pool is the common case anyway. The cost
— a third party can spend somebody's budget for one window — is why the reset
form reports how long to wait rather than failing silently.

**It fails open**, the one deliberate exception to this codebase's fail-closed
rule. Sign-in cannot succeed without the database anyway, so failing open
grants nothing, while failing closed would turn a database blip into a total
sign-in outage. The error is logged, so a limiter that has stopped working is
visible rather than merely ineffective.

A clock that appears to go backwards (NTP correction, two servers disagreeing)
is treated as *inside* the window — the safe direction, refusing rather than
resetting the counter.

Expired rows are pruned by the daily job rather than on the request path;
nothing depends on the prune for correctness.

---

## 3. Content-Security-Policy, and the thing it broke

`src/proxy.ts` now sets CSP with a **per-request nonce**, plus
`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` and `Strict-Transport-Security` — on every response,
public routes included. The sign-in form is exactly where a clickjacking or
form-action attack would be aimed.

It is set in middleware rather than `next.config.ts` because a static config
header cannot carry a per-request value.

**The first deployment of it broke the application completely**: 15 console
violations, hydration never completed, and no interactive control worked. The
cause is worth recording because it is not obvious. Next stamps the nonce onto
the script tags **it** emits, by reading it back out of the CSP header it is
served with — but it cannot do that for a `<script>` written by hand. This
codebase has two, `ThemeScript` and `ThemeModeSync`, which apply the stored
colour scheme before first paint to avoid a flash. Both were refused.

The fix propagates the nonce through a request header (`x-coreworks-nonce`) so
the two components can set the attribute themselves. Re-verified in a real
browser: zero violations, sign-in works, the theme toggle writes `localStorage`
and applies the class.

`style-src` keeps `'unsafe-inline'` — React writes inline styles and Phase 12's
branding stylesheet is an inline `<style>`. That is a real weakening, bounded
by Phase 12's guarantee that those values are re-serialised from parsed
numbers. Moving the branding stylesheet onto the nonce is recorded in
`deployment.md` as the most worthwhile remaining hardening.

---

## 4. The audit trail gets a reader

`AuditLog` had been written since Phase 11 and read by nobody.
`/settings/security` reads it, gated on `settings:manage` — Owner and Admin,
rather than the `activity:view` that opens the business trail to Managers.
Failed sign-ins and bulk exports across a deployment are an administrator's
concern.

Phase 14 also gives it something to show: every sign-in outcome, every
password-reset request, and the import and export actions from Phase 13.

### The one entry that crosses the tenant boundary

A failed sign-in against an address belonging to nobody has no organization.
Written with `organizationId: null`, it is shown in **every** administrator's
trail — because scoping it away would mean an attack in progress, the case the
page exists for, was visible to no one. What is disclosed is an email address
and a timestamp, no client data, and the row is marked "unattributed" on
screen.

**Live verification found this had been implemented too broadly, and it was
fixed.** Because `authorize` runs before any organization context exists, the
first version wrote *every* sign-in entry with a null organization —
successes included. That meant an administrator of one organization could see
that a member of another had signed in, which is a good deal more than the
design intends. Attribution now resolves the account's organization wherever
the account is known:

| Outcome | Attributed? |
|---|---|
| `success`, `bad_password`, `no_active_membership` | Yes — the account exists |
| `unknown_or_disabled` | No — there is no account to attribute it to |
| `rate_limited` | No — refused before any lookup, deliberately; doing the lookup anyway hands back the work the limit exists to refuse |

A user in several organizations is attributed to their oldest membership;
duplicating the row into each would multiply an attack's trail by however many
organizations the victim happens to belong to.

Verified live afterwards: two organizations, three sign-in attempts. The
demo organization sees all three; the second organization sees only the
unattributed one.

The *reason* for a failure is recorded even though the caller is never told
it. That asymmetry is the point — the endpoint stays uniform so it cannot
enumerate accounts, while an administrator investigating afterwards can tell a
forgotten password from an attack on a disabled account.

Every write is wrapped: a trail that can refuse a sign-in is a liability, not
a control.

---

## 5. A defect the production build caught that development did not

`audit-filters.tsx` is a Client Component and imported `auditActionLabel` from
the module that also queries `AuditLog`. In development both are evaluated on
the server, so it worked. `next build` traced the import into the browser
bundle and failed on `pg` requiring `dns` and `fs`.

The labels are pure, so they moved to `src/lib/domain/audit-actions.ts`. The
lesson is the general one: a Client Component importing anything from
`server/services` is a bundling error waiting to happen, and only the
production build finds it.

Worth stating plainly — **`npm run dev` passing is not evidence that the
application builds.**

---

## 6. Tests

| File | Count | Covers |
|---|---|---|
| `tests/unit/rate-limit.test.ts` | 18 | Window boundaries, refused-attempt counting, clock going backwards, `Retry-After` rounding, key normalisation, the two configured rules |
| `tests/unit/route-permissions.test.ts` | 21 | Exact and prefix matching, longest-first ordering, no false prefix match, derivation from navigation, deduplication, agreement with the role matrix |
| `tests/integration/security.test.ts` | 34 | The limiter against real PostgreSQL, the audit trail's tenant scoping in both directions, and the password-reset action end to end |

The integration file is where the claims that matter are checked, against a
real database rather than a mock:

- the rate-limit **row** exists and holds the expected count, including for refused attempts;
- one budget survives varying capitalisation, and separate subjects do not share one;
- pruning removes only closed windows, and is safe to run twice;
- an entry with a null organization is visible to every administrator, and an attributed one to exactly one — asserted in both directions;
- a reset request for a known address is attributed, and for an unknown address is not;
- the reset flow supersedes outstanding tokens, stores a SHA-256 hash and never the token, answers an unknown address **byte-identically** to a real one, and issues nothing once refused;
- a malformed address is rejected before any budget is spent.

One test measures a **delta** rather than an absolute: `recentFailures`
deliberately counts unattributed entries from anywhere in the deployment, so
any other failed sign-in in the last 24 hours is legitimately in the baseline.
Asserting an absolute would have made the test a report on the database's
history — which is exactly how it first failed.

### Full suite

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | clean |
| `vitest run` | **2,839 passing**, 48 files |
| Parity suite | **1,670 assertions** against the real legacy `.gs` sources |
| `next build` | succeeds |
| `/legacy` | byte-for-byte identical to Phase 0 |

---

## 7. Live verification

Against a production build over real HTTP, signed in as each of the five
seeded roles.

**Security headers** — present on public and authenticated routes alike; the
CSP nonce differs on every request (three consecutive requests, three distinct
values), which is what proves nothing in front of the application is caching
the header.

**Unauthenticated access** — `/clients` returns 307 to
`/login?callbackUrl=%2Fclients`. Unknown paths also redirect rather than
404ing, so an unauthenticated caller cannot learn which routes exist.

**RBAC** — all 21 authenticated routes requested as Owner, Manager,
Accountant, Team Member and Viewer. Every result matched the permission matrix
computed independently from `hasPermission()`:

| Route | Owner | Manager | Accountant | Team Member | Viewer |
|---|---|---|---|---|---|
| `/activity` | 200 | 200 | **404** | **404** | **404** |
| `/settings/data` | 200 | 200 | 200 | 200 | **404** |
| `/settings/security` | 200 | **404** | **404** | **404** | **404** |
| all others | 200 | 200 | 200 | 200 | 200 |

The 404s are the point — before this phase they were 200.

**Cross-tenant** — a second organization was created with a client and a task,
and requested as the first organization's Owner. Four requests, all
not-found bodies, none containing the other organization's names. Removed
afterwards.

**Rate limiting** — six wrong-password submissions to the real credentials
endpoint produced five `sign_in.bad_password` entries and one
`sign_in.rate_limited`, with the stored counter at **6** (the refused attempt
counted). All six responses were identical 302s: the caller cannot tell being
refused from being wrong.

**Password reset** — four submissions of the real form over HTTP: three
accepted, the fourth refused with *"Too many reset requests for that address.
Try again in …"*. Exactly one outstanding token remained, confirming
supersession, and the audit trail held three `password_reset.requested`
(attributed) and one `password_reset.rate_limited` (unattributed).

**Regression** — all 19 principal routes from Phases 2–13 requested and
checked for expected content, not merely for a 200. All passed.

**Cleanup** — the rival organization, its users, and every audit,
rate-limit and reset-token row created during verification were removed, and
their absence confirmed by query.

---

## 8. Deployment

[`deployment.md`](./deployment.md) is new in this phase, and is what the README
has promised since Phase 0. It covers environment configuration, applying
migrations, running the application behind TLS, wiring the two scheduled jobs,
what must be true before the first sign-in, verifying a deployment from
outside, and upgrading.

Two parts of it came out of Phase 14's own investigation rather than from
general practice:

**A dedicated database role.** The default setup connects as `postgres` — a
superuser and the owner of every table. That was measured, not assumed, and it
is the reason the row-level-security evaluation below came out the way it did.

**Honest limitations.** The document says plainly that a locked-out user
cannot currently recover their own account, because no mail transport exists.
That is the sort of thing a deployment guide is for.

---

## 9. Row-level security — evaluated, not adopted

Listed as a hardening item since Phase 2. Phase 14 evaluated it against this
database and decided against it, for two measured reasons.

**As deployed it would be inert.** The application connects as `postgres`, a
superuser and table owner. PostgreSQL bypasses row security for superusers,
and for a table's owner unless the table also has `FORCE ROW LEVEL SECURITY`.
Policies added today would have no effect while looking, in a schema dump,
exactly like protection — the worst possible failure mode for a security
control.

**The tenant id has nowhere safe to live.** Policies need the current
organization, conventionally a session GUC. Prisma pools connections, and
probing this database showed a value set with `SET` was still readable by the
*next, unrelated* call on the same pooled connection. That is a leak, not a
missing feature: the next request handed that connection inherits somebody
else's tenant. `SET LOCAL` inside a transaction was confirmed to work — but
that means every read in the application runs inside an interactive
transaction, holding a connection for its whole duration.

What RLS would defend is already enforced in the application and covered by
cross-tenant integration tests in every module. It would be a genuinely
valuable second enforcement point, surviving a query written wrongly — but
buying it at the cost of routing every read through a transaction, on top of a
prerequisite the deployment does not yet satisfy, is the wrong order to do the
work in. The prerequisite is documented; the change itself is honest future
work.

---

## 10. What remains open

Phase 14 is the last phase in the plan, so these are open items for the
deployment rather than deferrals to a later phase. Each is written up in
[`security.md`](./security.md) with what closing it would take.

| Item | Status |
|---|---|
| Record-level `notFound()` returning 200 | Structural; the either/or is documented in §1 |
| Row-level security | Evaluated and declined, §9 |
| Email delivery | No transport exists. The only **functional** gap, not merely a hardening one — a locked-out user cannot self-recover |
| Session revocation on role change | Permissions are unaffected (the role is re-read every request); session lifetime is not |
| Attachment upload scanning | There is still no upload path; build it with one, not after |
| Multi-factor authentication | Post-v1, a product decision |
| `style-src 'unsafe-inline'` | Removable by moving the branding stylesheet onto the nonce |

---

## 11. Files

**New**

| File | Purpose |
|---|---|
| `src/lib/domain/rate-limit.ts` | Fixed-window arithmetic, pure |
| `src/lib/domain/audit-actions.ts` | The action vocabulary and its labels, client-safe |
| `src/server/services/rate-limit.ts` | The PostgreSQL-backed store and its failure policy |
| `src/server/services/audit-queries.ts` | Audit-trail reads, scoped to an organization or null |
| `src/server/auth/route-permissions.ts` | Route → permission, derived from navigation |
| `src/app/(app)/settings/security/` | The audit screen and its filters |
| `prisma/migrations/…_rate_limit/` | The `RateLimit` table |
| `docs/deployment.md` | New |
| `tests/unit/rate-limit.test.ts`, `tests/unit/route-permissions.test.ts`, `tests/integration/security.test.ts` | 73 tests |

**Changed**

| File | Change |
|---|---|
| `src/proxy.ts` | Security headers, the CSP nonce, and the pathname header |
| `src/app/layout.tsx`, `src/app/(app)/layout.tsx` | Read the nonce; the app layout pre-checks route permission |
| `src/components/theme/theme-script.tsx`, `theme-mode-sync.tsx` | Accept and apply the nonce |
| `src/server/auth/config.ts` | Rate limit before bcrypt; audit every sign-in outcome, attributed |
| `src/app/(auth)/forgot-password/actions.ts`, `forgot-password-form.tsx` | Reset rate limit, audit entries, and the refusal message |
| `src/server/actions/data-transfer.ts` | Audit entries for import and export |
| `src/server/jobs/scheduled.ts`, `scripts/run-job.ts` | Prune rate limits once per run, not once per organization |
| `src/lib/navigation.ts`, `src/components/layout/nav-icons.ts` | The Security entry |
| `docs/security.md` | Rewritten for what is now true |
| `.env.example` | Storage and email variables described by what they are, not by a phase that has passed |
