# Security

What is implemented as of Phase 2, and what is deliberately still outstanding.

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

## Audit trails

Two separate logs, on purpose:

- **`ActivityLog`** — the legacy business trail (audit §6.14). Member added, role changed, organization updated. Carries a `userEmail` snapshot so entries stay readable after a user is deleted.
- **`AuditLog`** — technical/security events: sign-ins, permission changes, exports, with IP and user agent.

## Not yet implemented

Named here so their absence is a decision rather than an oversight.

| Gap | Planned |
|---|---|
| Rate limiting on sign-in and password reset | Phase 13 |
| PostgreSQL row-level security as defence in depth | Phase 13 |
| Email delivery for reset links and invitations (tokens are issued and stored now; delivery is not) | Phase 11 |
| Multi-factor authentication | Post-v1 |
| Session revocation on role change (a JWT keeps its claims until expiry; the role is re-read from the database on every request, so this affects session lifetime, not permissions) | Phase 13 |
| Content Security Policy headers | Phase 13 |
| Attachment upload scanning | Phase 12 |

## Secrets

`AUTH_SECRET` and `DATABASE_URL` are server-only and never prefixed
`NEXT_PUBLIC_`. `.env` is git-ignored; `.env.example` carries empty
placeholders. The seed's demo password is a development fixture and the seeded
organization is marked `IS_DEMO_DATA`, so a production deployment can assert
it is absent.
