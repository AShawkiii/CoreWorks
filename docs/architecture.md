# Architecture

How CoreWorks is arranged, and why. For the legacy system this replaces, see
[`architecture-audit.md`](./architecture-audit.md); for the data model, see
[`database.md`](./database.md).

## Layering

Master prompt §36: business logic never lives in a React component.

```
UI (Server / Client Component)
  → Server Action        src/server/actions/     authorize, validate, shape errors
    → Service            src/server/services/    business rules, transactions, logging
      → Prisma           src/lib/db.ts           org-scoped queries
        → PostgreSQL
```

Each layer has exactly one job:

| Layer | Responsibility | Must not |
|---|---|---|
| Component | Render, collect input | Query the database, decide permissions |
| Action | Authorize, parse with Zod, convert errors to messages | Contain business rules |
| Service | Enforce rules, write, log activity | Read the session, format for display |
| Repository/Prisma | Query | Know about roles |

Services take an `OrgContext` rather than reading the session themselves. That
is what lets them run under test without a Next.js request — the integration
suite drives them directly.

## Module map

```
src/
  app/                  Routes. (auth) and (app) route groups
  components/
    brand/              Logo and wordmark
    layout/             Shell, sidebar, settings nav, page header
    theme/              Theme script and toggle
    ui/                 Design-system primitives
  lib/
    domain/             Enums, labels, IDs, template catalog — legacy vocabulary
    validation/         Zod schemas, shared by client and server
    db.ts               Prisma singleton
    navigation.ts       Sidebar structure (serializable data only)
    utils.ts            cn()
  server/
    actions/            Server actions
    auth/               Auth.js config, edge config, permission matrix
    services/           Business services
    context.ts          OrgContext and access errors — no auth import
    tenancy.ts          Session → OrgContext, permission entry points
  generated/prisma/     Prisma client (git-ignored)
legacy/                 Preserved Apps Script system. Never compiled or executed.
```

### Why `context.ts` and `tenancy.ts` are separate

`tenancy.ts` imports Auth.js. If services imported from it, the whole service
layer would transitively depend on the authentication framework — which broke
the integration tests outright, because Auth.js cannot load outside a Next
request.

`context.ts` holds the `OrgContext` type and the access errors with no auth
import. Services depend on that; `tenancy.ts` produces the context and
re-exports the rest so callers still have a single import.

## Server and client boundary

Two constraints shaped the layout:

**Only serializable data crosses.** `navigation.ts` carries icon *names*, not
icon components — a React component is a function, and passing one from a
Server Component to a Client Component throws at runtime. The name is resolved
in `components/layout/nav-icons.ts`, on the client side of the boundary. The
build does not catch this; it surfaces only when the page is actually
rendered, which is why the app is run as part of each phase's verification.

**Middleware is not the authorization boundary.** `src/proxy.ts` (Next 16's
replacement for `middleware.ts`) redirects unauthenticated requests, but it
runs on the Edge runtime where Prisma is unavailable, so it cannot know roles
or tenancy. Every route and action re-checks. Middleware is a redirect
convenience.

## Design tokens

Every colour resolves through a semantic token in `src/app/globals.css` —
`--primary`, `--muted`, `--sidebar`, plus domain tokens for the four client
health states. No component contains a palette literal.

Tokens are HSL *channels* (`221 83% 53%`), not full colours, so an
organization's stored brand colour can be injected as a plain style attribute
and picked up by every consumer. That is what makes Phase 12's per-organization
branding possible without touching components.

Dark mode is authored, not inverted: health badges get low-chroma fills with
high-contrast text so a Delayed badge still reads as urgent.

`ThemeScript` applies the stored preference in `<head>` before first paint, so
there is no flash. The toggle reads that preference through
`useSyncExternalStore` rather than copying it into state in an effect, which
keeps render consistent and picks up changes made in another tab.

## Phasing

Phase 3 ports the legacy business rules with a parity test suite **before**
any dashboard is built on them. That ordering is deliberate: the rules are the
asset being migrated, and a screen built on an unverified rule is worse than
no screen, because it looks authoritative.

Until then, interim surfaces show plainly-labelled raw counts rather than
approximations of the legacy KPIs, which have precise definitions
(audit §8.2).

## Extensibility

Master prompt §71 asks that future modules (invoicing, AP/AR, payroll) be
possible without restructuring. Three things carry that weight:

- **Tenancy is a column, not a deployment.** A new table joins the model by carrying `organizationId` and being queried through an org-scoped service.
- **Permissions are a flat string list.** A new module adds entries to `PERMISSIONS` and to the role arrays; nothing else changes.
- **Navigation is data.** A new section is an entry in `NAV_SECTIONS`, filtered by permission automatically.
