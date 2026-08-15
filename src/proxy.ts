import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { edgeAuthConfig } from "@/server/auth/edge-config";

const { auth } = NextAuth(edgeAuthConfig);

/** Routes reachable without a session. Everything else requires sign-in. */
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
* First line of defence only.
 *
 * Middleware keeps unauthenticated users out of app routes, but it is not the
 * authorization boundary — server actions and route handlers re-check the
 * session and permissions through `src/server/tenancy.ts`. A middleware-only
 * check would be bypassable and would not know about roles or tenancy.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  if (!req.auth) {
    const signInUrl = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
