# Security

What is implemented as of Phase 14, and what is deliberately still outstanding.

## Where CoreWorks starts from

The legacy system had one access rule (audit §10):

```
email present in EMPLOYEES  AND  Active? = "Yes"  →  full access to everything
```

No roles, no per-record scoping, no tenancy. `EMPLOYEES.Role` held job titles
used to resolve template assignees — never consulted for access. Legacy's own
`architecture.md` §10 states that role-based access control was "deferred to
the future web application."

So the authorization model here is **new construction**, not a migration. The
one property worth carrying over is that legacy failed **closed**: any error
during its access check denied access. That is preserved.

## Authentication

Auth.js v5, credentials provider, JWT sessions.

- **Passwords** are hashed with bcrypt at cost 12. A hash is never returned from a query that feeds a response.
- **Minimum length is 12 characters**, with no composition rule. Length dominates resistance to offline cracking; forcing symbols mostly produces predictable substitutions.
- **Sign-in requires an active membership** in at least one organization — the equivalent of legacy's `Active? = Yes`. A deactivated member cannot sign in even with valid credentials (verified live, and in the integration suite).
- **Failures are uniform.** Unknown email, wrong password, deleted user, and deactivated membership all return the same error and the same null session. The sign-in endpoint cannot be used to enumerate accounts.
- **Password reset** issues a 32-byte random token, stores only its SHA-256 hash, expires in one hour, supersedes any outstanding token, and is invalidated when the password changes. The "we sent a link" response is identical whether or not the address exists.
- **Changing a password requires the current one**, even though the session is already authenticated — this stops an unattended signed-in browser being used to seize the account permanently.

### Rate limiting (Phase 14)

Both credential endpoints are limited, for two different reasons.

| Endpoint | Budget | Why |
|---|---|---|
| Sign-in | 5 attempts / 15 min, per account | Slow password guessing to a rate where a 12-character minimum is not the only thing standing in the way |
| Password reset | 3 requests / hour, per address | Each accepted request is meant to put mail in somebody's inbox, so an unlimited form is a way to flood a real person |

Four decisions are load-bearing:

**The counter is in PostgreSQL, not in memory.** A per-process counter gives an
attacker one budget per instance, and any real deployment runs more than one.
It also has to survive a restart — precisely the moment an attacker would
prefer it did not. `tests/integration/security.test.ts` asserts the row
actually exists rather than only that the decision came out right.

**The sign-in limit is checked before bcrypt.** bcrypt at cost 12 is
deliberately slow, so checking the limit first is also what stops a flood of
attempts becoming a CPU-exhaustion attack on top of a credential one.

**A refused attempt still counts, but never extends the window.** Counting it
means an attacker who keeps hammering extends their own lockout rather than
idling until the window rolls; keeping the window's original start means the
lockout still ends on schedule, so a third party cannot hold somebody locked
out indefinitely by continuing to submit.

**It is keyed on the account, not the address.** Auth.js `authorize` has no
request object, and an attacker rotating IPs through a proxy pool is the
common case anyway — the account is what needs protecting. The cost is that a
third party can spend somebody's sign-in or reset budget for one window. That
is the accepted trade-off, and it is why the reset form says how long to wait
rather than failing silently.

**The store fails open**, which is the one deliberate exception to this
codebase's fail-closed rule. If the database is unreachable the attempt is
allowed — but sign-in cannot succeed without the database anyway, since
`authorize` has to read the user, so failing open grants nothing. Failing
closed would turn a database blip into a total sign-in outage: a self-inflicted
denial of service far more likely than the attack it defends against. The
error is logged rather than swallowed, so a limiter that has stopped working
is visible rather than merely ineffective.

Expired rows are pruned by the daily job, not on the request path — nothing
depends on the prune for correctness, since a closed window is decided as
closed whether or not its row still exists.

## Browser policy (Phase 14)

`src/proxy.ts` sets these on **every** response, public routes included:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: https:`; `font-src 'self' data:`; `connect-src 'self'`; `frame-ancestors 'none'`; `form-action 'self'`; `object-src 'none'`; `base-uri 'self'`; `upgrade-insecure-requests` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, payment, and USB denied |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |

The nonce is generated per request and is what makes `script-src` strict:
without it the policy would need `'unsafe-inline'`, which is close to no
policy at all for the attack CSP exists to stop.

**Two things about the nonce are easy to get wrong, and both bit this
codebase before they were fixed.** Next stamps its own script tags by reading
the nonce back out of the CSP header it is served with — but it does *not*
stamp hand-authored `<script>` tags. This application has two of them
(`ThemeScript` and `ThemeModeSync`, which apply the stored colour scheme before
first paint to avoid a flash), and the first CSP deployment blocked both,
which broke hydration and left the page with no working controls. They now
receive the nonce explicitly, passed down from the layouts through the
`x-coreworks-nonce` request header. Verified with a real browser: zero console
violations, sign-in works, and the theme toggle writes `localStorage` and
applies the class.

`style-src` keeps `'unsafe-inline'`. React writes inline styles for the
preview swatches, and the organization branding stylesheet is an inline
`<style>` element. That is a genuine weakening of the policy. It is bounded by
what Phase 12 already guarantees — those values are re-serialised from parsed
numbers and cannot contain a brace or a closing tag — so there is no path from
stored data into a style rule. Moving the branding stylesheet onto the nonce
is the next step and is recorded in [`deployment.md`](./deployment.md).

Also set: `Strict-Transport-Security` is ignored by browsers over plain HTTP
and becomes correct the moment TLS terminates in front of the application, so
it is safe to send unconditionally.

## Authorization

Six roles with a 32-permission matrix (`src/server/auth/permissions.ts`).

| Role | Scope |
|---|---|
| Owner | Everything, plus billing. Can manage other Owners. |
| Admin | Organization settings, branding, members, all delivery work. |
| Manager | Clients, templates, services, members, all tasks. |
| Accountant | Any task, monthly close, issues, requests. |
| Team Member | Their own assigned tasks; can raise issues and requests. |
| Viewer | Read-only. |

Two rules are worth stating explicitly because they are easy to get wrong:

**Seniority is strict, except among Owners.** A role can only manage roles
strictly junior to it — an Admin cannot demote another Admin. Owners are the
exception: they can manage each other. Without that, nothing outranks an
Owner, so an Owner could never be demoted, deactivated, or created by an
existing Owner, and an organization whose owner left would be permanently
stuck with their access.

**The last active Owner is protected.** Demoting or deactivating them is
refused, so the exception above can never empty the role.

Both directions are checked on a role change — the member's current role *and*
the role being assigned. Checking only one would let an Admin promote a
Manager to Owner.

## Tenant isolation

Every business table carries `organizationId`, and every uniqueness constraint
is scoped by it.

The rule the code is arranged to make unavoidable:

> `organizationId` always comes from the authenticated session, never from a
> route parameter, form field, or request body.

Server actions call `requireOrgContext()` / `requirePermission()`
(`src/server/tenancy.ts`), which resolves the organization from the session,
and pass that context to services. Services never accept an organization id
from the caller.

Lookups by id are scoped in the `where` clause rather than fetched-then-checked,
so a record from another organization is not found at all. `assertSameOrg()`
exists as defence in depth for any query that slips through.

A cross-organization refusal reports "not found in this organization" rather
than "forbidden" — a distinct forbidden message would confirm the id exists
elsewhere.

Verified in `tests/integration/members.test.ts` against a real database: an
Owner of one organization cannot read, update, or deactivate a member of
another, and display-ID sequences are independent per organization.

## Server actions are endpoints

A Next.js server action is callable by anyone who knows its id; a hidden
button is not protection. Every action therefore authorizes *before* reading
its input, so an unauthorized caller cannot probe validation behavior.

`tests/unit/action-guards.test.ts` asserts structurally that every exported
action performs an authorization call, and that the permission strings named
actually exist. It catches an unguarded action being added later; it does not
prove runtime semantics — the integration suite does that.

Some decisions need a database lookup before they can be made. Task editing is
the first: a Team Member holds `task:update_own`, so whether they may edit
depends on whether they are the assignee. That check lives in a module-local
`requireTaskPermission` helper rather than inline. The guard test recognises
such `require*` helpers as authorization calls **and separately asserts that
each one performs a real check**, so a helper named `require…` cannot launder
an unguarded action past it.

## Input validation

Zod, on the server, for every mutation. The client form reuses the same schema
for immediate feedback, but the server re-parses and never trusts the client's
result.

Two validators are security-relevant rather than cosmetic:

- **Logo URL** must be `https://`. Rejecting other schemes blocks `javascript:` and `data:` URIs that would otherwise be rendered into an `<img src>`.
- **Organization slug** is restricted to a lowercase pattern and a reserved-word list, so a slug can never shadow an application route.

## Error handling

Raw errors never reach the browser. Actions convert a thrown error into either
a message written for users (permission refusals, rule violations such as
"This is the only active Owner") or a generic "Something went wrong", with the
detail logged server-side. The error boundary renders only what the action
chose to expose.

Pages call `notFound()` rather than showing "forbidden" for a section the user
cannot access — telling someone a page exists but is off-limits is itself
information.

### The `notFound()` status code — found in Phase 4, half fixed in Phase 14

From Phase 4 onward this documentation carried a known defect: a programmatic
`notFound()` returned **HTTP 200** with the not-found body rather than 404.
It was never an authorization hole — verified repeatedly by inspecting what a
Viewer actually receives on `/clients/new`, `/clients/[id]/edit`, `/tasks/new`
and `/tasks/[id]/edit`, including cross-tenant requests: no form, no submit
control, and zero record values in the HTML. The consequence was that a
caching layer or a crawler would treat a denied page as valid.

Phase 14 measured the cause rather than working around it. Genuine unknown
paths returned 404 correctly; only in-page calls returned 200. The suspect was
`src/app/(app)/loading.tsx` — a Suspense boundary flushes the shell, which
commits the status line, before the page component can call `notFound()`.
Removing `loading.tsx` made both cases return 404, confirming it; but deleting
the loading skeleton to fix a status code is a bad trade.

The fix checks **above** the boundary instead. `src/server/auth/route-permissions.ts`
derives a route → permission map from the same `NAV_SECTIONS` / `SETTINGS_NAV`
declarations the sidebar renders from, and `(app)/layout.tsx` — which runs
before the loading boundary — refuses there. Both the correct 404 and the
loading skeleton survive.

Deriving the map from navigation is the point, not a convenience: a
hand-written second list would drift from the sidebar, and a route that is
hidden but reachable is worse than one that is neither.
`tests/unit/route-permissions.test.ts` asserts the map covers every route
navigation declares a permission for, adds nothing it does not, names only
permissions the matrix knows, and is sorted longest-first so
`/settings/members` is never decided by a shorter `/settings` entry.

**The pages still check for themselves.** The layout guard is a second gate in
front of them, not a replacement — a page reached by a path the map does not
cover is still refused by its own check.

#### What is still 200, and why it cannot also be fixed

Only **route-level permission** refusals were closed. A **record-level**
`notFound()` — this client id belongs to another organization, or to nothing —
still returns 200 with the not-found body. Measured live in Phase 14, signed
in as an Owner of one organization against a client and a task belonging to
another:

| Request | Status | Body |
|---|---|---|
| `/clients/<other org's id>` | 200 | not-found page, no client data |
| `/clients/<other org's id>/edit` | 200 | not-found page, no form, no values |
| `/tasks/<other org's id>` | 200 | not-found page, no task data |
| `/tasks/<other org's id>/edit` | 200 | not-found page, no form, no values |
| `/clients/<id that exists nowhere>` | 200 | not-found page |

**No data leaks in any of these** — the responses were searched for the rival
records' names and contained neither. It remains a status-code defect, with
the same consequence as before: a cache or a crawler treats a denied page as
valid.

It cannot be fixed the same way, and this is a property of the framework
rather than an oversight. Whether a record exists *in this tenant* is only
knowable from a database read, and that read can only happen in the page —
below the `loading.tsx` Suspense boundary that has already committed the
status. Route permission is decidable from the path alone, which is exactly
why it could be moved above the boundary; record identity is not.

The remaining options are therefore a genuine either/or:

- **Keep the loading skeleton** and accept 200 on record-level refusals — what CoreWorks does.
- **Delete `(app)/loading.tsx`** and get 404 everywhere, losing the streamed skeleton on every page in the application. Verified to work; rejected as the worse trade.

Placing the boundary lower does not escape it: a `loading.tsx` in `/clients`
still sits above `/clients/[id]`, so the only arrangement that fixes detail
pages is one where they have no skeleton at all.

### Refusals from actions that cannot return state

`changeTaskStatusAction`, `deleteTaskAction`, and `deleteTaskCommentAction` are
plain `<form action>` submissions from Server Components, so they have no
`FormState` to return. Throwing would surface Next's generic error boundary,
and in production the real reason is redacted — precisely the part the user
needs. They redirect back with the message in `?error=`, rendered as an alert
banner. The value is rendered as text, so React escapes it; verified live with
a `<script>` payload.

## CSV import and export

An import is the most consequential thing a non-admin can do to this data set,
so it needs `data:import` (Manager and above); an export is a read and needs
`data:export` (Team Member and above). A **Viewer holds neither** — a bulk
extraction of the whole book of business is a different act from reading one
page of it.

Uploads are capped at 10 MB and read as text; nothing in a CSV is executed.
The MIME type is deliberately not enforced, because browsers report a `.csv`
inconsistently and the content is parsed as text either way. Enumerated values
are validated against the audit §5 vocabulary and an unrecognised value is a
rejected row, never a coerced one.

Every import and export query is scoped by `organizationId` from the session.
An export is the widest possible tenant leak available in this application —
one file containing an entire organization — so the cross-tenant tests check
every sheet rather than a sample.

## The branding stylesheet

Organization brand colours are rendered into a `<style>` element, which is an
injection surface. It is defended twice: the schema accepts only three numeric
HSL channels (`221 83% 53%` — never `#hex`, `rgb()`, a keyword, or anything
containing a brace or `</style>`), and the writer re-serialises from the parsed
**numbers** rather than echoing the stored string. Values are re-validated on
read as well, per slot, so a corrupt row degrades to one default colour rather
than to an injected rule. Logo URLs reuse the `https`-only rule from Phase 2,
so a logo can never be a `javascript:` or `data:` URI.

## Audit trails

Two separate logs, on purpose:

- **`ActivityLog`** — the legacy business trail (audit §6.14). Member added, role changed, organization updated. Carries a `userEmail` snapshot so entries stay readable after a user is deleted.
- **`AuditLog`** — technical/security events: sign-ins, permission changes, exports, with IP and user agent.

`ActivityLog` is readable at `/activity`, gated on `activity:view` — Owner,
Admin, and Manager. It is **append-only**: the query module exports no write
function and there is no write schema, both asserted by tests, so the screen
that displays the trail cannot become a way to edit it. A scheduled run is
recorded as the system (null `userId` plus a `system@coreworks.local` email
snapshot) and is distinguished on screen from a person since removed, who also
has a null `userId` but a real email beside it.

`AuditLog` is readable at `/settings/security` (Phase 14), gated on
`settings:manage` — Owner and Admin only, rather than the `activity:view` that
opens the business trail to Managers. It shows failed sign-ins, password-reset
requests, and bulk imports and exports, which is an administrator's concern.

**One entry deliberately crosses the tenant boundary, and it is the most
important one on the page.** A failed sign-in against an address that belongs
to no organization cannot be attributed to one, so it is written with
`organizationId: null` and shown in *every* administrator's trail. Scoping it
away would mean an attack in progress — the case the page exists for — was
visible to nobody. What is disclosed is an email address and a timestamp, no
client data, and the row is marked "unattributed" on screen so it is not
mistaken for a member of the reader's own organization. Attributed entries
stay strictly scoped: `tests/integration/security.test.ts` checks both
directions.

The reason for a failure is recorded even though the caller is never told it.
That asymmetry is the point: the endpoint stays uniform so it cannot be used
to enumerate accounts, while an administrator investigating afterwards can
still tell a forgotten password from an attack on a disabled account.

Writing to the trail can never refuse a sign-in — every write is wrapped and
logged on failure. A trail that can lock people out is a liability, not a
control.

Creating an organization is recorded here too, as
`organization.bootstrapped`. It is the one privileged operation with no
session behind it — `npm run bootstrap`, authorized by shell access to the
deployment rather than by a role — so a record of when a tenant appeared, and
which account became its Owner, is worth keeping. It is written inside the
same transaction as the organization itself, so a rolled-back bootstrap
leaves no entry claiming one happened.

Notifications are **not** governed by the role matrix. They are addressed to a
user id and every query is scoped by it, so `/notifications` and
`/settings/notifications` require authentication only: no role grants sight of
another person's, and none is denied their own. Read and preference mutations
scope their `where` by the user id rather than checking ownership after
loading, so the unsafe version cannot be written by accident.

## Closed in Phase 14

| Gap | Where it landed |
|---|---|
| Rate limiting on sign-in and password reset | `src/lib/domain/rate-limit.ts` (arithmetic), `src/server/services/rate-limit.ts` (store) — above |
| Content Security Policy headers | `src/proxy.ts` — above |
| A reader for `AuditLog` | `/settings/security` — above |
| `notFound()` returning 200 on a **permission** refusal | `src/server/auth/route-permissions.ts` + the app layout — above. The **record-level** half is not closed and cannot be without dropping the loading skeleton; see above |

## Not implemented

Named here so their absence is a decision rather than an oversight. Phase 14
is the last phase in the plan, so these are **open items for the deployment,
not deferrals to a later phase** — each one below says what it would take.

### PostgreSQL row-level security

Evaluated in Phase 14 and **not adopted**. Two findings decided it, both
measured against this database rather than assumed.

**As deployed, RLS would be silently inert.** The application connects as
`postgres`, a superuser and the owner of every table. PostgreSQL bypasses row
security entirely for superusers, and for a table's owner unless the table is
additionally set to `FORCE ROW LEVEL SECURITY`. Policies added today would
therefore have no effect while looking, in a schema dump, exactly like
protection. Adopting RLS starts with a dedicated non-owner application role —
which is worth doing on its own merits, and is written up in
[`deployment.md`](./deployment.md).

**The per-request organization id has nowhere safe to live.** RLS policies
need the current tenant, conventionally a session GUC (`app.org_id`). Prisma
pools connections, and a GUC set with `SET` outlives the statement that set
it: probing this database, a value set by one call was still readable by the
*next, unrelated* call on the same pooled connection. That is not a missing
feature, it is a leak — the next request to be handed that connection inherits
somebody else's tenant. The safe form is `SET LOCAL` inside a transaction,
which was also confirmed to work, but it means every read in the application
runs inside an interactive transaction. That is a substantial change to the
data layer, and interactive transactions hold a connection for their whole
duration, so it is a throughput cost on every page as well.

**What is being defended is already enforced and tested.** `organizationId`
comes from the session and never from a request; lookups scope in the `where`
clause rather than fetching-then-checking; cross-tenant refusals are covered
by integration tests in every module. RLS would be a second, independent
enforcement point — genuinely valuable, since it would survive a query written
wrongly — but it is defence in depth over a boundary that holds, and buying it
at the cost of routing every read through a transaction is the wrong order to
do the work in. The prerequisite (a non-owner role) is documented; the change
itself is honest future work, not something Phase 14 quietly shipped.

### Session revocation on role change

A JWT keeps its claims until it expires. **Permissions are not affected** —
the role is re-read from the database on every request, so a demotion takes
effect immediately for authorization. What survives is the session itself: a
member deactivated mid-session keeps a valid token until it expires.

Closing this means either a session table (a database read per request, which
is what JWT sessions exist to avoid) or a revocation list checked in the JWT
callback. The second is the smaller change and is the one to make; it was not
in Phase 14's scope, and stating that is better than a half-built version.

### Email delivery

Reset tokens and invitations are issued, hashed, and stored — nothing is
delivered, because there is no mail transport in the codebase and none is
configured for this deployment. In development the reset link is logged to the
server console; in production the flow completes and issues a token nobody
receives.

This is the one gap that is a **functional** limitation and not only a
hardening one, and it is why notifications are in-app only and the settings
page says so rather than offering an email toggle that would do nothing.
[`deployment.md`](./deployment.md) records what wiring a transport requires.

### Attachment upload scanning

There is still no upload path. `Attachment` exists in the schema but no screen
writes to it, and organization logos are `https` URLs rather than files. This
becomes real the moment an upload path is added, and should be built with it
rather than after it.

### Multi-factor authentication

Post-v1, unchanged. Auth.js supports it; the decision is a product one about
what an accounting team will tolerate at sign-in, not a technical blocker.

## Secrets

`AUTH_SECRET` and `DATABASE_URL` are server-only and never prefixed
`NEXT_PUBLIC_`. `.env` is git-ignored; `.env.example` carries empty
placeholders. The seed's demo password is a development fixture and the seeded
organization is marked `IS_DEMO_DATA`, so a production deployment can assert
it is absent.
