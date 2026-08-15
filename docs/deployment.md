# Deployment

Taking CoreWorks from a working checkout to a production instance.

[`setup.md`](./setup.md) covers running it locally. This covers everything
that is different when other people depend on it: what has to be configured,
what has to be true before the first sign-in, and what the application does
*not* do for you.

---

## What CoreWorks needs

| | Requirement | Notes |
|---|---|---|
| Node.js | 22 LTS or newer | Verified on 22.22.2 |
| PostgreSQL | 14 or newer | Verified on 16.13 |
| TLS termination | In front of the application | Required, see below |
| A scheduler | cron, a platform scheduler, or a workflow runner | The application has none of its own |

There is **no Google dependency at runtime** — no Apps Script, no Sheets API,
no Google account requirement. Sheets is one supported CSV shape among others
([`phase13-import-export.md`](./phase13-import-export.md)).

---

## 1. Environment

Everything is configured through environment variables. `.env.example` is the
complete list; these are the ones a deployment must set.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session tokens. `openssl rand -base64 32` |
| `AUTH_URL` | yes | The canonical origin, e.g. `https://coreworks.example.com` |
| `NEXT_PUBLIC_APP_URL` | recommended | Same origin. Read in exactly one place today — the development-only reset-link log — so nothing breaks without it, but set it so it is correct when something does depend on it |
| `NODE_ENV` | yes | `production` |

Three rules, each of which has a specific failure mode behind it:

**`AUTH_SECRET` must differ per environment.** A staging secret that also
works in production means a staging token is a production session.

**Only `NEXT_PUBLIC_`-prefixed variables reach the browser**, and nothing
secret may carry that prefix. `DATABASE_URL` and `AUTH_SECRET` are server-only
and must stay that way.

**`AUTH_URL` must match the origin users actually type**, including scheme and
any port. A mismatch produces session cookies scoped to the wrong host, which
presents as an endless redirect back to the sign-in page rather than as an
error — the cookie is set, then not sent back.

`.env` is git-ignored. In a hosted environment prefer the platform's secret
store over a file on disk.

---

## 2. Database

### Apply migrations

```bash
npm run db:deploy      # prisma migrate deploy
```

`db:deploy` applies committed migrations and nothing else. Do **not** use
`db:migrate` (`prisma migrate dev`) against a production database — it is a
development command that can prompt to reset.

Migrations are forward-only and are applied before the new build starts
serving. Every migration in this repository is additive; none drops a column
that a previous release still reads, so a rolling deploy is safe.

### Give the application its own role

The default local setup connects as `postgres`. A production deployment should
not, for two reasons — one general and one specific to this codebase.

The general reason is ordinary least privilege: the application needs DML on
its own schema and nothing else.

The specific reason is that **PostgreSQL bypasses row-level security for
superusers and for a table's owner**. Any future adoption of RLS is inert
until the application connects as a role that is neither
([`security.md`](./security.md) records the full evaluation). Creating the
role now is what keeps that door open.

```sql
CREATE ROLE coreworks_app LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE coreworks TO coreworks_app;
GRANT USAGE ON SCHEMA public TO coreworks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO coreworks_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO coreworks_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO coreworks_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO coreworks_app;
```

Run migrations as the owner (a separate, higher-privileged connection string
used only by the deploy step) and serve the application as `coreworks_app`.

### Backups

Nothing in the application backs itself up. `pg_dump` on a schedule, with a
restore actually tested at least once — an untested backup is a hypothesis.

The CSV export ([`phase13-import-export.md`](./phase13-import-export.md))
covers all eleven entities and is a genuine second copy in a format that
outlives this application, but it is not a substitute for a database backup:
it does not carry ids, timestamps, or the audit trails.

---

## 3. Build and run

```bash
npm ci
npm run db:deploy
npm run build
npm start
```

`postinstall` runs `prisma generate`, so the client is generated from the
schema in the checkout rather than from whatever was committed.

The build is a standard Next.js production build. `npm start` serves it on
port 3000 by default (`PORT` overrides).

### Behind a reverse proxy

Terminate TLS in front of the application and forward to it over the loopback
interface. The proxy must:

- send `X-Forwarded-Proto` and `X-Forwarded-Host`, so redirects and cookies resolve to the public origin;
- **not** strip or rewrite `Content-Security-Policy` — the policy carries a per-request nonce and a proxy that caches or replaces it will break every page;
- **not** add a second `Strict-Transport-Security` or `X-Frame-Options` header, since the application already sets both.

**TLS is not optional.** Sessions are cookie-borne and sign-in posts a
password. `Strict-Transport-Security` is sent unconditionally and is simply
ignored by browsers over plain HTTP, so it protects nothing until TLS is
actually in front.

---

## 4. Scheduled jobs

Legacy used Apps Script's time-based triggers. CoreWorks deliberately has no
scheduler of its own — the right one depends on where it runs — so it exposes
a runner that a real scheduler calls:

```bash
npm run job -- daily-recalculation    # cron: 0 2 * * *
npm run job -- monthly-generation     # cron: 0 3 1 * *
npm run job -- monthly-generation 2026-09
```

| Job | What it does | If it does not run |
|---|---|---|
| `daily-recalculation` | Recomputes client health and completion, sends due-soon and overdue reminders, prunes expired rate-limit rows | Health and dashboards go stale — a deadline passes because the date rolled over, not because anyone edited anything, so nothing else triggers the recalculation |
| `monthly-generation` | Expands recurring work from service-package templates and opens the monthly close | The month's recurring tasks are never created |

Both sweep **every** organization, since a deployment-level cron is not signed
in as any tenant, and both are safe to re-run: generation deduplicates on
`client|serviceArea|taskName|period`, and the daily pass sends nothing twice
in a day.

**The runner exits non-zero if any tenant failed**, so a partial run cannot
look like success. Wire that exit code to an alert — a job that silently stops
running is the failure mode that takes longest to notice, because the
application keeps serving perfectly while its numbers quietly age.

Run them on **one** instance, not on every replica.

---

## 5. Creating the first organization

Four operations touch this database and they are routinely confused with one
another. They are not interchangeable:

| Operation | Command | What it is for | Production? |
|---|---|---|---|
| **Migrations** | `npm run db:deploy` | Creates and updates the *schema* — tables, indexes, constraints. Never data | **Required** |
| **Bootstrap** | `npm run bootstrap` | Creates one organization and its first Owner. The only supported way to create a tenant | **Required, once** |
| **Seed** | `npm run db:seed` | Creates a demo organization with a password committed to this repository, plus fictional clients and tasks | **Never** |
| **CSV import** | Settings → Import & export | Loads *business data* into an organization that already exists, signed in as a member of it | Optional |

### The bootstrap

Nothing else in CoreWorks creates an `Organization`. There is no public signup
route, and **CSV import cannot do it**: the importer accepts eleven sheets —
`EMPLOYEES`, `SERVICES`, `SERVICE_PACKAGES`, `TASK_TEMPLATES`, `CLIENTS`,
`TASKS`, `CLIENT_REQUESTS`, `ISSUES`, `MONTHLY_CLOSE`, `ACTIVITY_LOG`,
`SETTINGS` — none of them `ORGANIZATION`, and every import runs inside an
`organizationId` taken from the session of somebody already signed in.

```bash
npm run bootstrap -- \
  --name "Meridian Advisory" \
  --owner-name "Amara Okafor" \
  --owner-email amara.okafor@meridian.example
```

It creates, in **one transaction**: the organization, its default settings
(the legacy SETTINGS values from audit §6.1), a theme row, the Owner's user
account with a bcrypt hash, an `OWNER` membership with display ID `EMP-001`,
and the member counter that the next invitation continues from. If any step
fails, none of it remains — there is no half-created tenant to unpick.

`--slug` is derived from `--name` when omitted, and validated either way
against the same reserved-word rule the Settings screen uses. Pass it
explicitly when the derived value is not what you want, or when the name does
not reduce to a usable slug.

**The password is never a command-line argument.** Anything on `argv` is
visible to every other process through `ps` and is recorded in shell history.
The script reads it from `COREWORKS_OWNER_PASSWORD` when set, and otherwise
prompts twice with the echo suppressed. It is never printed and never logged.
The 12-character minimum is the same one the application enforces everywhere
else.

Passing `--password` is refused with an explanation rather than silently
accepted.

For unattended provisioning:

```bash
COREWORKS_OWNER_PASSWORD="$(cat /run/secrets/owner-password)" \
  npm run bootstrap -- --name "…" --owner-name "…" --owner-email "…"
```

Exit code is `0` on success, `2` for a usage or input error, `1` for anything
else. Re-running with a slug or an email that already exists is refused
cleanly and changes nothing, so a failed provisioning run is safe to repeat.

An existing account is **refused rather than adopted** — bootstrap sets a
password, so silently reusing an address would either ignore the password you
supplied or overwrite somebody's existing one. Add an existing person to an
organization from Settings → Members instead.

The bootstrap is deliberately **not an HTTP endpoint**. Every authorization
decision in CoreWorks starts from a session and an organization; creating the
first organization has neither, so exposing it over HTTP would mean an
unauthenticated route that can mint an Owner. Shell access to the deployment
is the authorization, exactly as it is for `prisma migrate deploy`.

### Confirm the demo data is absent

`npm run db:seed` must never run against production. The seeded organization
is marked so its absence can be asserted rather than assumed:

```sql
SELECT o.slug
FROM "OrganizationSetting" s
JOIN "Organization" o ON o.id = s."organizationId"
WHERE s.key = 'IS_DEMO_DATA' AND s.value = 'true';
```

This must return no rows. If it returns any, that organization was seeded and
its accounts share a password that is in this repository. A bootstrapped
organization never carries that marker, so this check cannot produce a false
alarm on a real tenant.

### Then load the business data

Sign in as the Owner, then import from Settings → Import & export in
dependency order ([`migration-plan.md` §3.3](./migration-plan.md)):

```
EMPLOYEES → SERVICES → SERVICE_PACKAGES → TASK_TEMPLATES → CLIENTS
         → TASKS → CLIENT_REQUESTS → ISSUES → MONTHLY_CLOSE
         → ACTIVITY_LOG → SETTINGS
```

The importer refuses a file whose prerequisites are absent rather than
rejecting every row for an unresolvable reference, so a sequencing mistake
reads as a sequencing mistake.

Note the delivery gap in §6 before relying on the password-reset flow for
anyone.

---

## 6. What is not wired, and what it costs you

Stated plainly so nothing is discovered in production.

### Email delivery

**There is no mail transport.** Password-reset tokens and invitations are
generated, hashed, and stored; nothing is sent. In development the reset link
is logged to the server console. In production the flow completes, the user is
told a link is on its way, and no link arrives.

Practical consequence: **a locked-out user cannot recover their own account.**
An administrator must set a password directly, or the token must be read from
the database and the link constructed by hand.

Wiring a transport means: `EMAIL_FROM` and `SMTP_URL` (already reserved in
`.env.example`), a send call in
`src/app/(auth)/forgot-password/actions.ts` where the link is currently logged,
and the same for member invitations. The reset rate limit (3/hour per address)
is already in place, so a transport can be added without simultaneously
becoming a way to flood an inbox.

Notifications are in-app only for the same reason, and the settings page says
so rather than offering an email toggle that would do nothing.

### File uploads

There is no upload path. `Attachment` exists in the schema and the
`STORAGE_*` variables are reserved, but nothing writes to either. Organization
logos are `https` URLs, not files. Upload scanning is listed as not
implemented in [`security.md`](./security.md) and should be built together with
the upload path rather than after it.

### Row-level security

Not adopted; evaluated and written up in [`security.md`](./security.md).
Tenant isolation is enforced in the application and covered by cross-tenant
integration tests in every module. Creating the non-owner database role above
is the prerequisite if you decide to add it.

### Session revocation

A deactivated member keeps a valid session token until it expires.
Permissions are unaffected — the role is re-read from the database on every
request — so this is session lifetime, not authorization. Shortening the
session lifetime reduces the window without any code change.

### Tightening `style-src`

The Content-Security-Policy still allows `'unsafe-inline'` for styles, because
the organization branding stylesheet is an inline `<style>` element. Moving it
onto the same per-request nonce the scripts use would let that be dropped.
It is a small, self-contained change and the most worthwhile remaining
hardening.

---

## 7. Verifying a deployment

Run these against the deployed origin, not against localhost.

**Security headers are present on a public route:**

```bash
curl -sI https://coreworks.example.com/login | grep -i \
  -e content-security-policy -e strict-transport -e x-frame-options
```

The CSP must contain a `nonce-` value, and that value must **differ between
two requests**. A constant nonce means something in front of the application
is caching the header, which silently defeats the policy.

**An unauthenticated request to an app route redirects rather than renders:**

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  https://coreworks.example.com/clients
```

Expect `307` to `/login?callbackUrl=/clients`.

**Migrations are fully applied:**

```bash
npx prisma migrate status
```

**The jobs run and report:** trigger `daily-recalculation` manually once and
confirm both the log output and a zero exit code.

**Demo data is absent:** the query in §5.

**The organization was bootstrapped correctly:**

```sql
SELECT o.slug,
       m."displayId",
       m.role,
       u.email,
       left(u."passwordHash", 7)          AS hash_prefix,
       (SELECT count(*) FROM "OrganizationSetting" s
         WHERE s."organizationId" = o.id) AS settings
FROM "Organization" o
JOIN "OrganizationMember" m ON m."organizationId" = o.id
JOIN "User" u ON u.id = m."userId"
WHERE m.role = 'OWNER';
```

Expect one row per organization: role `OWNER`, display ID `EMP-001`, six
settings, and a hash prefix of `$2a$12$` or `$2b$12$`. A `hash_prefix` that
looks like anything else means a password was stored unhashed — it never can
be through the bootstrap, but this is the check that would catch it.

---

## 8. Upgrading

1. Take a database backup, and confirm it restores.
2. `npm ci` — the lockfile is authoritative.
3. `npm run db:deploy` **before** starting the new build. Migrations are additive, so the previous release keeps working against the new schema for the length of the rollout.
4. `npm run build`, then restart.
5. Confirm `npx prisma migrate status` reports no pending migrations, and that the checks in §7 still pass.

Rolling back a release is a redeploy of the previous build. Rolling back a
*migration* is a restore from backup — there are no down migrations, by
design: a down migration that drops a column is a data-loss path sitting in
the repository waiting to be run at the worst possible moment.
