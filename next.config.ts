import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Compile-time checking of every <Link href>. Catches a link to a route
  // that does not exist before it ships.
  typedRoutes: true,
  // The legacy Apps Script mirror is reference material, never compiled.
  outputFileTracingExcludes: {
    "*": ["./legacy/**/*"],
  },
};

export default nextConfig;
