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
| Node.js | **22 or newer** | Enforced by `engines` in `package.json`. Verified on 22.22.2 |
| PostgreSQL | 14 or newer | Verified on 16.13 |
| TLS termination | In front of the application | Required, see §3 |
| A scheduler | cron, a platform scheduler, or a workflow runner | The application has none of its own |
| Container runtime | Optional | A production `Dockerfile` is provided; `npm start` works without it |

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

### Backups and restore

**Nothing in this application backs itself up.** If your platform provides
managed backups, that is where they come from; Railway and Render both offer
them on their managed PostgreSQL, and you should confirm what retention you
actually have rather than assuming. What follows works anywhere.

**What must be backed up:** the PostgreSQL database, in full. That is the only
stateful thing — there are no uploaded files (no upload path exists), and the
application writes nothing to disk at runtime. `AUTH_SECRET` must also be
stored somewhere durable and separate: losing it invalidates every session,
which is survivable, but it is not recoverable from the database.

**Taking a backup:**

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --file="coreworks-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
```

`--format=custom` is compressed and restores selectively. `--no-owner` and
`--no-privileges` mean the dump restores cleanly into a database owned by a
different role, which is exactly what happens when you restore production into
a staging instance to test it.

**Restoring:**

```bash
createdb coreworks_restore
pg_restore --no-owner --no-privileges --dbname="$RESTORE_URL" coreworks-….dump
```

Restore into a **new** database, never over a live one. Then point a checkout
at it and verify before switching anything:

```bash
DATABASE_URL="$RESTORE_URL" npx prisma migrate status   # expect: up to date
DATABASE_URL="$RESTORE_URL" npm run check:env
```

**Verifying a restore actually worked** — a dump that restores without error
can still be empty. Check that the data is there and that the derived state is
coherent:

```sql
SELECT (SELECT count(*) FROM "Organization")       AS organizations,
       (SELECT count(*) FROM "Client")             AS clients,
       (SELECT count(*) FROM "Task")               AS tasks,
       (SELECT count(*) FROM "OrganizationMember") AS members,
       (SELECT max("createdAt") FROM "ActivityLog") AS last_activity;
```

`last_activity` is the useful one: it tells you how recent the backup really
is, which is the question you will actually be asking during an incident.

**When to run them:** daily at minimum, retained long enough to cover the time
it takes somebody to notice a problem — for a month-end close cycle that is
weeks, not days. Run one restore test on a schedule you will actually keep.
An untested backup is a hypothesis.

The CSV export ([`phase13-import-export.md`](./phase13-import-export.md))
covers all eleven entities and is a genuine second copy in a format that
outlives this application. It is **not** a substitute for a database backup:
it carries no ids, timestamps, audit trails, or user accounts.

---

## 3. Build and run

```bash
npm ci
npm run db:deploy
npm run build
npm start
```

`postinstall` runs `prisma generate`, so the client is generated from the
schema in the checkout rather than from whatever was committed. `src/generated/`
is git-ignored — there is never a stale committed client to go out of date.

The build is a standard Next.js production build. `npm start` serves it on
port 3000 by default (`PORT` overrides).

Optionally check the environment before starting:

```bash
npm run check:env
```

It reports missing or dangerous configuration — an unset `AUTH_SECRET`, a
placeholder value, an `AUTH_URL` that is not https, a secret carrying a
`NEXT_PUBLIC_` prefix — and exits non-zero on any error. It never prints a
value, only the name of the variable and what is wrong with it. Without it,
a missing signing key is discovered by the first person who tries to sign in.

### Container image

`Dockerfile` builds a three-stage production image: dependencies → build →
runtime.

```bash
docker build -t coreworks .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://…" \
  -e AUTH_SECRET="…" \
  -e AUTH_URL="https://coreworks.example.com" \
  coreworks
```

Details that matter:

**It uses Next's standalone output** (`output: "standalone"` in
`next.config.ts`), which traces the modules the application actually imports
and emits a self-contained `server.js`. The alternative is shipping the whole
`node_modules` tree. This is safe here specifically because the Prisma client
this project generates is **pure JavaScript** — the `prisma-client` generator
with `@prisma/adapter-pg` needs no native query engine — so there is no binary
for tracing to miss and no musl/OpenSSL problem on Alpine.

**It does not change local development.** Standalone is an additional output
alongside the normal build; `npm run dev` and `npm start` behave exactly as
before.

**It runs as non-root** — the `node` user (uid 1000) that ships with the base
image. Nothing in the application writes to disk at runtime.

**It contains no secrets.** `DATABASE_URL`, `AUTH_SECRET` and `AUTH_URL` are
supplied at run time, and `.dockerignore` excludes `.env` from the build
context entirely.

> **One trap worth knowing about.** `next build` copies a project-root `.env`
> into `.next/standalone/.env`. Measured, not assumed: building this project
> locally produced a standalone `.env` byte-identical to the developer's own,
> `AUTH_SECRET` and `DATABASE_URL` included. `.dockerignore` keeps `.env` out
> of the build context so there is normally nothing to copy, and the Dockerfile
> deletes it after the build regardless. If you ever build this image by some
> other route, check the artifact.

**It does not run migrations.** Those are a deploy step (§6), not something
every container start races on.

### Health check

`GET /api/health` — unauthenticated, no database, ~7ms:

```json
{ "status": "ok", "uptime": 412, "time": "2026-08-15T23:09:58.092Z" }
```

It is reachable without a session because a platform probe cannot acquire
one — `/api/health` is in the middleware's public prefix list. Without that
entry the probe receives the same 307 redirect to `/login` as any other
unauthenticated request, most platforms score that as a failure, and the
deployment never goes live.

**It deliberately does not check the database.** This was a decision, and the
reasoning is worth keeping:

1. **A restart cannot fix a database outage.** Every platform here reacts to a
   failing health check by killing and replacing the instance. If this endpoint
   reported the database's health, a database blip would take down every
   application instance too — and each replacement would come up, fail the
   same check, and be killed in turn. That turns a recoverable dependency
   failure into a restart loop.
2. **It is unauthenticated by necessity.** An open endpoint that opens a
   database connection on demand is a free amplification vector: a few requests
   a second from anywhere, each consuming a connection from a pool sized for
   real users.
3. **Database reachability is already gated at deploy time.** `db:deploy` runs
   before the application starts, so a deployment that cannot reach the
   database fails before it serves anything. Afterwards, `prisma migrate
   status` answers the same question and authenticates with `DATABASE_URL`
   rather than being open to the world.

So this is a *liveness* probe — "is this process up and serving HTTP" — which
is what platform health checks act on. Readiness against dependencies is a
different question, answered by the deploy sequence.

If you decide you want a dependency check anyway, add it as a **separate**
path, keep it off the platform's `healthcheckPath`, and put it behind a shared
secret or an internal network — do not make the liveness probe do two jobs.

The body is three fields, none of them configuration. A test pins that it has
exactly those three, because a debug-friendly `version` or `env` field added
later is how configuration accidentally becomes public.

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

**Run them on exactly one runner.** Neither job takes a lock, and neither is
harmed by a concurrent duplicate — generation deduplicates on
`client|serviceArea|taskName|period` and the daily pass will not send the same
reminder twice in a day — but two simultaneous sweeps would still contend on
the same rows and double the connection load for no benefit. Schedule them as
dedicated one-off runs (Railway cron services, a platform scheduler, or cron on
a single host), never as a loop inside the web process and never on every
replica.

The web container does **not** run them: its start command is the standalone
server and nothing else. That is deliberate — a job triggered from inside the
serving process would run once per replica.

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

**The health endpoint answers, unauthenticated:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://coreworks.example.com/api/health
```

Expect `200`. This is the same path the platform probes, so a failure here
explains a deployment that never goes live.

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

### Rolling back

Two different problems with two different answers.

**Rolling back the application** — a bad release, schema unchanged. Redeploy
the previous image or commit. Because every migration in this repository is
additive, the previous release runs correctly against the newer schema, so
this needs no database work at all. On Railway, redeploy the prior deployment;
with the container image, run the previous tag.

**Rolling back a migration** — restore from backup, per §2. There are no down
migrations, by design: a down migration that drops a column is a data-loss
path sitting in the repository waiting to be run at the worst possible moment.
Restore into a new database, verify it as described in §2, then repoint
`DATABASE_URL`.

Decide which you are doing before you start. Reaching for a database restore
when the schema never changed loses every write since the backup for no
reason.

---

## 9. Deployment platform

**Railway**, unless something in your organization dictates otherwise.

The choice follows from the architecture rather than from preference. CoreWorks
has four properties that matter here:

| Property | Consequence |
|---|---|
| A long-lived Prisma connection pool (`src/lib/db.ts` keeps one client per process) | Wants a persistent process, not one that multiplies per invocation |
| Two Node scheduled jobs (`npm run job`) | Needs somewhere to run a command on a schedule |
| Server-rendered pages, server actions, middleware | Needs a real Node runtime |
| A per-request CSP nonce set in middleware | Nothing in front may cache the response headers |

| Platform | Fit | Cost of using it |
|---|---|---|
| **Railway** | **Best** | Builds the provided `Dockerfile`, managed PostgreSQL in the same project, native cron services, health check honoured. **No application changes.** |
| Render | Good | Equivalent capability: Docker deploys, managed PostgreSQL, cron jobs. Slightly more configuration by hand. No application changes. |
| Fly.io | Good | Persistent processes and `fly postgres`. Machines-based scheduling is more manual, and multi-region needs care with a single writer. No application changes. |
| Vercel | **Worst fit** | Serverless functions multiply the connection pool, so it needs a pooler (PgBouncer in transaction mode, Neon, or Supabase pooling); the jobs need Vercel Cron plus a protected route handler that does not exist; and the edge cache must be kept away from the CSP header. Three adaptations to fit the platform, none of which the application needs. |

Vercel is the obvious default for a Next.js application and it is the wrong one
here. That is worth stating plainly: this is a server-rendered application with
a database pool and background jobs, not a static site with API routes.

`railway.json` is committed and declares the Dockerfile builder, the health
check path, and a single replica. No platform-specific code exists anywhere in
`src/` — moving to Render or Fly means changing deployment configuration, not
the application.

### Deploying on Railway

1. Create a project and add **PostgreSQL** from the service catalogue.
2. Add a service from this repository. Railway sees `railway.json` and builds the `Dockerfile`.
3. Set variables on the application service:
   - `DATABASE_URL` — reference Railway's PostgreSQL variable rather than pasting it, so a credential rotation propagates.
   - `AUTH_SECRET` — `openssl rand -base64 32`, unique to this environment.
   - `AUTH_URL` — the public origin, `https://…`, no trailing slash. Set it *after* the domain exists, and redeploy.
   - `NODE_ENV=production`.
   - `PORT` is provided by Railway; the image honours it.
4. Set the **pre-deploy command** to `npx prisma migrate deploy` so migrations
   run once per deployment, before the new version serves. Do not put migrations
   in the container's start command — every replica would race on start.
5. Deploy. Railway waits for `/api/health` before routing traffic.
6. Bootstrap the first organization (§5) — one-off, from the service shell.

TLS is terminated by Railway on its own domains and on custom domains, so
`Strict-Transport-Security` becomes meaningful as soon as the domain is live.

### Scheduling the jobs on Railway

Add **two more services** from the same repository, each with a cron schedule
and a start command that overrides the image default:

| Service | Start command | Cron (UTC) |
|---|---|---|
| `daily-recalculation` | `npm run job -- daily-recalculation` | `0 2 * * *` |
| `monthly-generation` | `npm run job -- monthly-generation` | `0 3 1 * *` |

Railway runs a cron service to completion and does not restart it, which is
exactly the semantics these jobs want — see §4 for the single-runner
requirement and what each job does.

Note that the runtime image is the Next standalone server and does not include
the `tsx` toolchain that `npm run job` needs. Give the job services a build
that keeps devDependencies — the simplest correct option is to let Railway
build them with its Node builder rather than the Dockerfile, or add a second
build target. Whichever you choose, verify the job service actually runs once
before relying on it: a cron that fails silently looks identical to one that
has nothing to do.

---

## 10. Database connections

`src/lib/db.ts` keeps **one `PrismaClient` per process**, cached on `globalThis`
in development so hot reload does not open a new pool on every edit. Each client
owns one `pg` pool.

This is a persistent-process design and it is deliberate. Do not:

- construct a `PrismaClient` anywhere else — services take the shared instance, or a transaction client (`Db = Prisma.TransactionClient | typeof prisma`) when they need to participate in one;
- assume serverless, where each concurrent invocation gets its own pool and the connection count is a function of traffic rather than of instance count.

**Sizing.** Connections are consumed per application instance, not per user:

```
instances × pool size  +  a spare connection for each cron run
                       +  headroom for psql and migrations
                       ≤  PostgreSQL max_connections
```

The `@prisma/adapter-pg` default pool is 10. One replica plus two occasional
cron runs is comfortably inside the default `max_connections` of 100. Raise
replicas past roughly eight and it stops being comfortable — at that point
either lower the pool size per instance (`?connection_limit=` on
`DATABASE_URL`) or put PgBouncer in front in transaction mode.

**A pooler is not required for the recommended deployment.** Railway's managed
PostgreSQL with a single replica needs none. It becomes necessary if you move
to a serverless platform, or scale replicas well beyond a handful.

**Interactive transactions hold a connection for their duration.** The
bootstrap and the CSV import both use one; both are short and infrequent. This
is the reason row-level security was declined in Phase 14 — adopting it would
have put *every read* inside a transaction ([`security.md`](./security.md)).

---

## 11. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

install → `prisma generate` → `migrate deploy` → typecheck → lint → **full test
suite** → production build → `/legacy` integrity.

It stands up a real PostgreSQL 16 service container, because the integration
suite gates on `DATABASE_URL` and skips without one — a run with no database
would report green while testing far less than it appears to.

**It never deploys and holds no deployment credentials.** Publishing stays an
explicit decision. `AUTH_SECRET` in the workflow is a test-only literal that
protects nothing real.

The `/legacy` step diffs against the Phase 0 commit and fails the build on any
change. The legacy suite itself is deliberately *not* run: it carries one known
failure preserved from Phase 0 (110/111), so a green/red signal from it would
be misleading. Byte-for-byte identity is the check that means something.
