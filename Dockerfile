# CoreWorks production image (Phase 15).
#
# Three stages, so the runtime image carries neither the build toolchain nor
# the source: deps → build → runtime.
#
# Node 22 to match `engines` in package.json and the version the project is
# verified on. Alpine is safe here specifically because this project's Prisma
# client is pure JavaScript — the `prisma-client` generator with
# `@prisma/adapter-pg` needs no native query engine, so none of the usual
# musl/OpenSSL engine problems apply.

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# The schema is copied first because `postinstall` runs `prisma generate`,
# which reads it. Without it the install fails.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma

# `npm ci` installs exactly the lockfile, including devDependencies — the
# build needs TypeScript, Tailwind, and the Prisma CLI. None of it reaches the
# runtime stage.
RUN npm ci

# ---------------------------------------------------------------------------
# 2. Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Regenerated rather than copied: `src/generated/` is git-ignored, so it may
# not exist in the build context, and a stale copy would be worse than none.
RUN npx prisma generate

# Placeholders exist only to satisfy anything read at build time. They are
# baked into no runtime behaviour — every value is read again from the
# environment when the container starts — and none is a real credential.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# `next build` copies a project-root `.env` into `.next/standalone/.env`.
# Measured, not assumed: building this project locally produced a standalone
# `.env` byte-identical to the developer's own, AUTH_SECRET and DATABASE_URL
# included.
#
# `.dockerignore` already keeps `.env` out of the build context, so there is
# normally nothing here to copy. This is the second lock: if that entry is ever
# removed or the file is renamed, a real credential would otherwise be baked
# into an image that gets pushed to a registry.
RUN rm -f .next/standalone/.env .next/standalone/.env.*

# ---------------------------------------------------------------------------
# 3. Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next honours PORT; this is the default a platform may override.
ENV PORT=3000
# Without this the server binds loopback inside the container and the platform
# health check cannot reach it.
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. `node` (uid 1000) ships with the base image, so
# there is no user to create — and nothing in this application writes to disk
# at runtime, so no ownership beyond the app directory is needed.
RUN chown -R node:node /app
USER node

# The standalone server: `next build` traces exactly the modules the
# application imports and writes a self-contained `server.js` beside them.
COPY --from=build --chown=node:node /app/.next/standalone ./
# Static assets are NOT traced into standalone and must be copied separately —
# without this the application serves HTML with every stylesheet and script
# 404ing, which looks like a broken build rather than a missing copy.
COPY --from=build --chown=node:node /app/.next/static ./.next/static

# There is deliberately no `COPY /app/public` line: this project has no
# `public/` directory, and `COPY` fails the build when its source is absent.
# If one is ever added, add the copy with it — the standalone server serves
# `public/` when present and silently 404s its contents when it is not.

# Migrations are NOT run by this image. They are a deploy step
# (`npm run db:deploy`) that runs once, before the new version serves — see
# docs/deployment.md §6. Running them from every container start would race
# across instances and couple a schema change to a restart.

EXPOSE 3000

# No secret is baked in: DATABASE_URL, AUTH_SECRET and AUTH_URL are supplied
# by the platform at run time. `.dockerignore` keeps `.env` out of the build
# context entirely, so one cannot arrive by accident.
CMD ["node", "server.js"]
