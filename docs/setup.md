# Setup

Getting CoreWorks running locally.

## Requirements

| | Version | Notes |
|---|---|---|
| Node.js | 22 LTS or newer | Verified on 22.22.2 |
| npm | 10 or newer | Verified on 10.9.7 |
| PostgreSQL | 14 or newer | Verified on 16.13 |

## 1. Install dependencies

```bash
npm install
```

## 2. Provide a database

Any PostgreSQL instance works — local, Docker, Supabase, Neon, or Railway.

Local:

```bash
createdb coreworks
```

Docker:

```bash
docker run --name coreworks-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=coreworks -p 5432:5432 -d postgres:16
```

## 3. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/coreworks?schema=public"
AUTH_SECRET="<paste the value below>"
AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

Generate a secret:

```bash
openssl rand -base64 32
```

`AUTH_SECRET` signs session tokens. It is server-only — never prefix it with
`NEXT_PUBLIC_`, and use a different value in every environment.

## 4. Create the schema

```bash
npm run db:migrate
```

Applies every migration in `prisma/migrations` and generates the Prisma client
into `src/generated/prisma`.

## 5. Seed demo data (optional)

```bash
npm run db:seed
```

Creates one demo organization with 5 members, 20 services, 3 service packages,
47 task templates, 10 clients, and fixture tasks, issues, and requests.

Sign in with:

```
amara.okafor@example.com  /  CoreWorks-Demo-2026
```

The seeded organization uses the slug `demo-meridian` and carries an
`IS_DEMO_DATA` setting, so a production deployment can assert it is absent.
Never run the seed against production — it deletes and recreates that
organization.

## 6. Run

```bash
npm run dev
```

Open http://localhost:3000. You will be redirected to `/login`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:deploy` | Apply migrations without generating one (CI/production) |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drop, re-migrate, and re-seed — destructive |

## Notes

**Prisma 7.** The connection URL lives in `prisma.config.ts`, not in
`schema.prisma`, and the client is instantiated with the `@prisma/adapter-pg`
driver adapter. The generated client is written to `src/generated/prisma` and
is git-ignored — run `npm run db:generate` after pulling a schema change.

**`/legacy`.** The preserved Google Apps Script system. It is excluded from
TypeScript, ESLint, and the Next.js build, and is never executed. It exists as
the business-rules reference (see `architecture-audit.md`).

## Troubleshooting

**`DATABASE_URL is not set`** — `.env` is missing or unreadable. It must be at
the repository root.

**`Can't reach database server`** — PostgreSQL is not running, or the port
differs. Check with `pg_isready -h 127.0.0.1 -p 5432`.

**`Module not found: @/generated/prisma/client`** — the client has not been
generated yet. Run `npm run db:generate`.

**Sign-in rejects a seeded user** — sign-in requires an *active* membership in
at least one organization, matching the legacy `Active? = Yes` rule. Check
`OrganizationMember.isActive`.
