# Phase 15 — Production infrastructure and deployment

Not part of the original migration plan, which ends at Phase 14 ([audit
§17](./architecture-audit.md)). This is an explicitly authorized
production-readiness phase, added after the Phase 14 deployment inspection
found that CoreWorks was *deployment-prepared* rather than deployable: the
documentation existed, the infrastructure did not.

**The application is functionally unchanged.** No business logic, no schema, no
UI, no permissions. Every change is either infrastructure or documentation.

---

## What this phase inherits

| From | What it depends on |
|---|---|
| Phase 1 | `next.config.ts`, the Prisma schema and migrations, `src/lib/db.ts` |
| Phase 2 | The middleware in `src/proxy.ts`, which decides what is reachable without a session |
| Phase 10 | `scripts/run-job.ts` and the two scheduled jobs |
| Phase 14 | The CSP nonce, the security headers, `docs/deployment.md`, the environment audit |
| Bootstrap fix | `npm run bootstrap` — the only supported way to create a tenant |

---

## 1. Build configuration

`engines: { "node": ">=22.0.0" }` added to `package.json`. The project is
verified on 22.22.2 and nothing pinned it, so a platform picking Node 18 by
default would have failed at build time with an error about syntax rather than
about versions.

`output: "standalone"` added to `next.config.ts`. It traces the modules the
application actually imports and emits a self-contained `server.js`, which is
what the container image runs. Two things make this safe here rather than
merely convenient:

- **It changes nothing locally.** Standalone is an *additional* output beside the normal build. `npm run dev` and `npm start` behave exactly as before — verified.
- **The Prisma client is pure JavaScript.** The `prisma-client` generator with `@prisma/adapter-pg` needs no native query engine, so there is no binary for tracing to miss and no musl/OpenSSL problem on Alpine. Checked rather than assumed: `find src/generated/prisma -name "*.node"` returns nothing.

No dependency was upgraded.

---

## 2. The container image

Three stages — dependencies, build, runtime.

| Requirement | How |
|---|---|
| Lockfile install | `npm ci`, with `prisma.config.ts` and `prisma/` copied first because `postinstall` runs `prisma generate` and reads the schema |
| Prisma generate | Explicit `npx prisma generate` in the build stage. Regenerated, never copied — `src/generated/` is git-ignored, so a copy would be stale or absent |
| Next build | `npm run build` with `NODE_ENV=production` |
| Correct start | `node server.js` from the standalone output |
| `PORT` | Honoured by Next; defaulted to 3000 |
| `HOSTNAME=0.0.0.0` | Without it the server binds loopback inside the container and the platform's health check cannot reach it |
| Non-root | The `node` user (uid 1000) from the base image. Nothing writes to disk at runtime |
| No secrets | `.dockerignore` excludes `.env` from the build context; all three secrets arrive as environment variables at run time |

### The secret `next build` copies into the artifact

The one genuinely surprising finding of this phase, and it was found by
building rather than by reading.

`next build` with standalone output copies a project-root `.env` into
`.next/standalone/.env`. Building this project locally produced a standalone
`.env` **byte-identical to the developer's own** — `AUTH_SECRET` and
`DATABASE_URL` included.

In the Docker build this does not happen, because `.dockerignore` keeps `.env`
out of the build context entirely, so there is nothing to copy. But that is one
line of configuration standing between a developer's real database credential
and an image pushed to a registry. The Dockerfile now also deletes it after the
build:

```dockerfile
RUN rm -f .next/standalone/.env .next/standalone/.env.*
```

Verified afterwards: the simulated runtime layout contains no `.env`, and a
search for the literal `AUTH_SECRET` value across the whole artifact returns
nothing.

### A build error the same exercise caught

The first Dockerfile copied `/app/public`, which every Next.js Dockerfile does.
**This project has no `public/` directory**, and `COPY` fails the build when
its source is absent. The line is gone, with a comment saying what to do if one
is ever added — the standalone server serves `public/` when it exists.

### What could not be verified here

The image was **not built end to end in this environment.** The Docker daemon
runs, but this container's network policy denies Docker Hub's layer CDN
(`production.cloudfront.docker.com` — a 403 at the proxy, recorded in its relay
log), so `node:22-alpine` cannot be pulled.

Rather than claim a verification that did not happen, the runtime stage was
reproduced natively: the standalone output was copied into a clean directory
exactly as the `COPY` instructions arrange it, the `.env` removed as the
Dockerfile removes it, and the server started with `node server.js` against the
real database. Every live check in §7 below ran against **that** process — the
same artifact the image runs, in the same layout.

What remains unverified is specifically the image build: base image resolution,
layer caching, and `USER node` file ownership. Build it once before relying on
it.

---

## 3. Health check

`GET /api/health` — unauthenticated, no database, three fields, ~7ms measured.

It is in the middleware's public prefix list because a probe has no session and
cannot acquire one. Without that entry it receives the 307 redirect to `/login`
that every other unauthenticated request gets, most platforms score that as a
failure, and the deployment never goes live.

**The decision the brief asked to be made explicitly: it does not check the
database.** Three reasons:

1. **A restart cannot fix a database outage.** Railway, Render and Fly all react to a failing health check by killing and replacing the instance. If this reported the database's health, a database blip would take down every application instance too, and each replacement would fail the same check and be killed in turn. A recoverable dependency failure becomes a restart loop.
2. **It is unauthenticated by necessity**, so a database check would be a free amplification vector — a few requests a second from anywhere, each taking a connection from a pool sized for real users.
3. **Deploy-time reachability is already covered.** `db:deploy` runs before the application serves, so a deployment that cannot reach the database fails first. `prisma migrate status` answers the same question afterwards and authenticates with `DATABASE_URL`.

This is a *liveness* probe. Readiness against dependencies is a different
question, answered by the deploy sequence. `deployment.md` §3 records how to add
a deeper check if an operator wants one, and why it should be a separate path.

A test pins that the payload has exactly three fields, because a debug-friendly
`version` or `env` added later is how configuration accidentally becomes
public.

---

## 4. Environment

`.env.example` rewritten to describe what the code **actually reads**, verified
against the source rather than assumed:

- `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` — required. The last two are read by Auth.js itself, which is why they appear nowhere in a grep of `src/`.
- `NEXT_PUBLIC_APP_URL` — corrected from "required" to optional. It is read in exactly one place: the development-only reset-link log.
- `STORAGE_*`, `EMAIL_*` — reserved. Nothing reads them, and the file now says so.

`npm run check:env` validates a real environment against the same rules and
exits non-zero on any error: missing variables, placeholder or too-short
`AUTH_SECRET`, non-https `AUTH_URL` (loopback excepted), a non-PostgreSQL
`DATABASE_URL`, and — the one that is easy to do by accident — any variable
whose `NEXT_PUBLIC_` prefix would compile a secret into the browser bundle.

The rules are pure (`src/lib/env.ts`), so every one is tested. **It never prints
a value**, only the variable's name and what is wrong with it; a check that
echoes `DATABASE_URL` into a build log to prove it is set has leaked the
credential it was verifying. A test asserts that property directly.

It is a pre-start check, deliberately not a module-load assertion: a hard throw
at import time would take down a running instance over a configuration change a
human could otherwise fix.

---

## 5. Platform

**Railway**, chosen from the architecture rather than from preference.

| Platform | Fit | Cost |
|---|---|---|
| **Railway** | Best | Builds the Dockerfile, managed PostgreSQL, native cron services, health check honoured. **No application changes** |
| Render | Good | Equivalent capability, more manual configuration |
| Fly.io | Good | Persistent processes; scheduling is more manual |
| Vercel | Worst | Needs a connection pooler, needs Vercel Cron plus a protected route handler that does not exist, and needs the edge cache kept away from the CSP header |

Vercel is the obvious default for a Next.js application and it is the wrong one
here — this is a server-rendered application with a long-lived database pool
and background jobs, not a static site with API routes.

`railway.json` declares the builder, `healthcheckPath`, and a single replica.
**No platform-specific code exists in `src/`** — moving to Render or Fly is a
configuration change, not an application one.

The one wrinkle, documented rather than papered over: the runtime image is the
standalone server and does not carry the `tsx` toolchain `npm run job` needs, so
the cron services need a build that keeps devDependencies. `deployment.md` §9
says so and says to verify a job service runs once before relying on it.

---

## 6. Scheduled jobs, connections, backups, CI

**Jobs** — unchanged. No wrapper was added, no architecture converted: the
existing `npm run job` runner is what a scheduler calls. `deployment.md` §4 now
states the single-runner requirement explicitly, and that the web container
deliberately does not run them (its start command is the standalone server and
nothing else — a job triggered inside the serving process would run once per
replica).

**Connections** — `src/lib/db.ts` unchanged. Documented: one `PrismaClient` per
process, one pool each, sized `instances × pool + cron runs + headroom ≤
max_connections`. The adapter default of 10 is comfortable for one replica and
stops being so past roughly eight. A pooler is **not** required for the
recommended deployment; it becomes required on serverless or at high replica
counts.

**Backups** — a real procedure: what to back up (the database, plus
`AUTH_SECRET` stored separately), `pg_dump --format=custom --no-owner`, restore
into a *new* database, and how to verify a restore actually worked — including
`max("createdAt") FROM "ActivityLog"`, which tells you how recent the backup
truly is, the question you will actually be asking during an incident. Nothing
claims backups are automated; if the platform provides them, that is stated as
the platform's doing.

**CI** — `.github/workflows/ci.yml`: install → generate → migrate → typecheck →
lint → full suite → build → `/legacy` integrity, against a real PostgreSQL 16
service container because the integration suite skips without `DATABASE_URL`.
It **never deploys** and holds no deployment credentials. The legacy suite is
deliberately excluded — it carries one known failure preserved from Phase 0
(110/111), so its green/red signal would mislead; byte-for-byte identity
against the Phase 0 commit is the check that means something, and CI fails on
any drift.

---

## 7. Verification

### Gate

| | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint` | clean |
| `vitest run` | **2,886 passing**, 51 files (22 new) |
| Parity | **1,670** — unchanged |
| Legacy suite | **110/111** — unchanged baseline |
| `next build` | succeeds, standalone emitted |
| `/legacy` | byte-for-byte identical to Phase 0 (tree hash `8e9c50d`) |

### Live, against real PostgreSQL

Run against the standalone artifact in the image's runtime layout, not against
`npm run dev`.

| Check | Result |
|---|---|
| `/api/health` | 200, 7ms, `{status, uptime, time}`, `Cache-Control: no-store` |
| Health unauthenticated | 200 without any cookie |
| `POST /api/health` | 405, empty body — no stack trace |
| `/login` | 200 |
| Unauthenticated `/clients` | 307 → `/login?callbackUrl=%2Fclients` |
| Demo user sign-in | succeeds against the real database |
| Protected routes | `/dashboard`, `/clients`, `/tasks`, `/activity`, `/settings/security`, `/settings/members` all 200 |
| Database queries | real client rows render |
| Derived values | health states and completion render |
| CSP nonce | rotates across three consecutive requests |
| Security headers | all six present on the standalone runtime |
| Secrets in output | none — `AUTH_SECRET`, `DATABASE_URL`, and any `postgresql://` string absent from `/login`, `/dashboard`, `/api/health` |
| Logout | 302, and `/dashboard` afterwards returns 307 |

### Clean-database deployment path

Exercised end to end on a database created for the purpose:

```
createdb → prisma migrate deploy (3 migrations) → migrate status: up to date
        → npm run bootstrap → organization + owner created
        → npm run job -- daily-recalculation → 1 ok, 0 failed, exit 0
        → re-run → identical result
```

`npm run check:env` was verified in both directions: exit 1 with four findings
on a deliberately broken environment, exit 0 on a correct one.

The temporary database and its organization were dropped afterwards. **The demo
data was not touched.**

---

## 8. What this phase did not do

Named so their absence is a decision:

- **No automatic deployment.** CI validates; publishing stays an explicit act.
- **No application code for any platform.** `railway.json` is configuration.
- **No change to `src/lib/db.ts`.** The connection design was documented, not rewritten.
- **No change to the jobs.** They were documented, not converted.
- **No dependency upgrades.**
- **No new business logic, schema, migration, permission, or UI.** The only `src/` changes are the health route, the two new library modules it and `check:env` use, and one line in `src/proxy.ts` adding `/api/health` to the public prefixes.

The functional gaps from Phase 14 are unchanged and still listed in
[`security.md`](./security.md): no mail transport, no upload path, session
revocation, row-level security, and record-level `notFound()` returning 200.
