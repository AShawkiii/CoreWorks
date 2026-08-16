import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * A single PrismaClient per process, created on **first use** rather than on
 * import.
 *
 * ---------------------------------------------------------------------------
 * Why lazily, and not at module scope
 * ---------------------------------------------------------------------------
 *
 * `next build` imports every route's module graph to read its route
 * configuration — the "Collecting page data" step — before it renders
 * anything. Constructing the client at module scope therefore ran
 * `createPrismaClient()` during the build, and in a container build there is
 * no `DATABASE_URL` (deliberately: `.dockerignore` keeps `.env` out of the
 * build context and no secret is passed as a build argument). The build failed
 * with "DATABASE_URL is not set" while collecting `/login` and `/` — both
 * *public* pages that never query anything, which is the giveaway that this
 * was an import-time side effect rather than a rendering problem.
 *
 * Deferring construction to first property access fixes the cause. Nothing
 * about how callers use `prisma` changes, and nothing about tenancy,
 * authorization, or connection behaviour changes either: still one client per
 * process, still one pool, still cached across dev hot reloads.
 *
 * **The `DATABASE_URL` check is not weakened.** It still throws, on the first
 * real use — which in a running deployment is the first request that touches
 * the database, and in a build is never. `npm run check:env` is what catches a
 * missing variable before a process starts serving.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure it.",
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

/**
 * Returns the process-wide client, creating it once.
 *
 * Cached on `globalThis` in every environment, not only development. The dev
 * reason is unchanged — hot reload would otherwise open a new pool on every
 * edit until PostgreSQL refuses connections — and in production the module is
 * evaluated once anyway, so the cache simply makes "one client per process" a
 * property of the code rather than of the module loader.
 */
export function getPrismaClient(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * The shared client.
 *
 * A proxy so that importing this module costs nothing and touching it creates
 * the client. Every call site keeps its existing shape — `prisma.client
 * .findMany(...)`, `prisma.$transaction(...)` — and `typeof prisma` still
 * resolves to `PrismaClient`, which is what `Db = Prisma.TransactionClient |
 * typeof prisma` throughout the services relies on.
 *
 * Functions are bound to the real client: `prisma.$transaction(...)` would
 * otherwise be invoked with the proxy as `this`, and Prisma's internals expect
 * their own instance.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    return Reflect.set(getPrismaClient(), property, value);
  },
  has(_target, property) {
    return Reflect.has(getPrismaClient(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(getPrismaClient());
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(getPrismaClient(), property);
  },
});
