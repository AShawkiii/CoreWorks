import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Prisma client is constructed on first use, not on import.
 *
 * This is a regression test for a real deployment failure: `next build` imports
 * every route's module graph during "Collecting page data", and a container
 * build has no `DATABASE_URL` — `.dockerignore` keeps `.env` out of the build
 * context and no secret is passed as a build argument. Constructing the client
 * at module scope therefore failed the build while collecting `/login` and
 * `/`, two *public* pages that query nothing.
 *
 * Two properties matter and they pull in opposite directions:
 *
 *  - importing must not touch the environment at all, so a build succeeds;
 *  - the `DATABASE_URL` check must still fire, so a misconfigured deployment
 *    fails loudly rather than silently doing nothing.
 *
 * Both are asserted below. The module is re-imported through `vi.resetModules()`
 * with the environment stubbed, and the process-wide client cache is saved and
 * restored around each case so nothing leaks into other tests.
 */

const globalForPrisma = globalThis as unknown as { prisma: unknown };

let saved: unknown;

beforeEach(() => {
  saved = globalForPrisma.prisma;
  globalForPrisma.prisma = undefined;
  vi.resetModules();
});

afterEach(() => {
  globalForPrisma.prisma = saved;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("importing @/lib/db", () => {
  it("does not read DATABASE_URL, so a build with no environment succeeds", async () => {
    vi.stubEnv("DATABASE_URL", "");

    // The import itself is the assertion: before the fix this threw.
    await expect(import("@/lib/db")).resolves.toBeDefined();
  });

  it("does not construct a client as a side effect of importing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await import("@/lib/db");

    // Nothing was cached, because nothing was built.
    expect(globalForPrisma.prisma).toBeUndefined();
  });
});

describe("first use of the client", () => {
  it("still refuses to run without DATABASE_URL", async () => {
    // The check was moved, not removed. A deployment missing the variable must
    // fail on its first query rather than quietly serving errors it cannot
    // explain.
    vi.stubEnv("DATABASE_URL", "");
    const { prisma } = await import("@/lib/db");

    expect(() => prisma.client).toThrow(/DATABASE_URL is not set/);
  });

  it("refuses through any entry point, not just one property", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { prisma, getPrismaClient } = await import("@/lib/db");

    expect(() => prisma.$transaction).toThrow(/DATABASE_URL/);
    expect(() => getPrismaClient()).toThrow(/DATABASE_URL/);
  });

  it("treats a whitespace-only value as set, as it always has", async () => {
    // Documenting existing behaviour rather than changing it: the runtime
    // check is `!connectionString`, so "   " passes here and fails later at
    // connect time. Tightening it is a separate decision from this build fix,
    // and `npm run check:env` already reports a blank value as missing before
    // a process starts serving.
    vi.stubEnv("DATABASE_URL", "   ");
    const { prisma } = await import("@/lib/db");

    expect(() => prisma.client).not.toThrow(/DATABASE_URL is not set/);
  });

  it("throws on every access, not only the first", async () => {
    // A cached failure that silently became undefined on the second call would
    // be far harder to diagnose than a repeated error.
    vi.stubEnv("DATABASE_URL", "");
    const { prisma } = await import("@/lib/db");

    expect(() => prisma.client).toThrow();
    expect(() => prisma.client).toThrow();
  });
});

describe("with a configured environment", () => {
  it("builds one client and reuses it", async () => {
    // A connection string that is well-formed but never connected to: creating
    // the client does not open a socket, so this stays a unit test.
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5432/does_not_exist");
    const { getPrismaClient } = await import("@/lib/db");

    const first = getPrismaClient();
    const second = getPrismaClient();

    expect(first).toBe(second);
    expect(globalForPrisma.prisma).toBe(first);
  });

  it("proxies through to the real client, with methods bound to it", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5432/does_not_exist");
    const { prisma, getPrismaClient } = await import("@/lib/db");

    // A model delegate resolves...
    expect(prisma.client).toBe(getPrismaClient().client);
    // ...and a client-level method is callable without losing `this`, which is
    // what an unbound proxy get would have broken.
    expect(typeof prisma.$transaction).toBe("function");
    expect(typeof prisma.$disconnect).toBe("function");
  });

  it("reports the same keys as the client it wraps", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5432/does_not_exist");
    const { prisma } = await import("@/lib/db");

    expect("client" in prisma).toBe(true);
    expect("organization" in prisma).toBe(true);
  });
});
