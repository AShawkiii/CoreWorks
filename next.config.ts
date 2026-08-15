import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Compile-time checking of every <Link href>. Catches a link to a route
  // that does not exist before it ships.
  typedRoutes: true,
  /**
   * Phase 15: emit `.next/standalone`, a self-contained server with only the
   * modules the application actually imports.
   *
   * This exists for the container image and nothing else. It does not affect
   * `npm run dev`, and `npm start` keeps working exactly as before — standalone
   * is an *additional* output alongside the normal build, not a replacement.
   *
   * It matters here because the alternative is shipping the whole
   * `node_modules` tree into the image. The Prisma client this project
   * generates is pure JavaScript — the `prisma-client` generator with
   * `@prisma/adapter-pg` needs no native query engine — so tracing captures
   * everything the runtime needs.
   */
  output: "standalone",
  // The legacy Apps Script mirror is reference material, never compiled.
  outputFileTracingExcludes: {
    "*": ["./legacy/**/*"],
  },
};

export default nextConfig;
