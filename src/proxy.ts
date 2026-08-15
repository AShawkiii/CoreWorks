import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { edgeAuthConfig } from "@/server/auth/edge-config";

const { auth } = NextAuth(edgeAuthConfig);

/**
 * Routes reachable without a session. Everything else requires sign-in.
 *
 * `/api/health` is here because a platform health probe has no session and
 * cannot acquire one. Without it the probe receives the 307 redirect to
 * `/login` that every other unauthenticated request gets, which most platforms
 * score as a failure — the deployment then never goes live. The endpoint
 * returns no secret and reads nothing (see `app/api/health/route.ts`).
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth",
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Header carrying the request path to Server Components.
 *
 * A Server Component layout has no `usePathname`, and the authenticated layout
 * needs the path to pre-check the route's declared permission — which is what
 * makes a refusal return 404 rather than 200 (see
 * `server/auth/route-permissions.ts`).
 *
 * Middleware sets it on every request it forwards, overwriting anything
 * inbound, so a caller cannot inject a path of their choosing.
 */
export const PATHNAME_HEADER = "x-coreworks-pathname";

/**
 * Header carrying the CSP nonce to Server Components.
 *
 * Next adds the nonce to the script tags IT emits, by reading it back out of
 * the `Content-Security-Policy` header. It cannot do that for a `<script>` this
 * codebase writes by hand — `ThemeScript` and `ThemeModeSync` both do, because
 * theme selection has to run before first paint. Those two read this header and
 * set the attribute themselves.
 *
 * Found by enforcing the policy in a real browser: without it, both scripts are
 * refused, hydration never completes, and the application does not work at all.
 */
export const NONCE_HEADER = "x-coreworks-nonce";

/**
 * Security response headers, closing the CSP gap `security.md` has carried
 * since Phase 2.
 *
 * Set in middleware rather than `next.config.ts` because the policy carries a
 * **per-request nonce**, and a static config header cannot.
 *
 * Each directive, and why it has the value it has:
 *
 *  - `default-src 'self'` — nothing loads from anywhere else by default.
 *  - `script-src 'self' 'nonce-…' 'strict-dynamic'` — the nonce is what makes
 *    this worth having. `'strict-dynamic'` lets Next's bootstrap load the
 *    chunks it needs without enumerating hashed filenames, and it makes modern
 *    browsers ignore any host allowlist, so an injected `<script src>` cannot
 *    be smuggled in through a permitted origin.
 *  - `style-src 'self' 'unsafe-inline'` — required, and the honest reason is
 *    that Phase 12 injects the organization's brand as an inline `<style>` and
 *    React writes inline styles for the preview swatches. The exposure is
 *    bounded by what Phase 12 already guarantees: those values are
 *    re-serialised from parsed numbers and cannot contain a brace or a closing
 *    tag (`buildThemeCss`). Moving styles onto the nonce is the next step and
 *    is recorded in `deployment.md`.
 *  - `img-src 'self' data: https:` — organization logos are arbitrary https
 *    URLs by design; Phase 2's `logoUrlSchema` permits nothing else.
 *  - `connect-src 'self'` — no third-party telemetry, and none is wanted.
 *  - `frame-ancestors 'none'` — clickjacking, in its modern form.
 *    `X-Frame-Options` is set alongside for older agents.
 *  - `form-action 'self'` — a form cannot be repointed at another origin.
 *  - `object-src 'none'`, `base-uri 'self'` — the two classic bypasses.
 */
function securityHeaders(nonce: string): Record<string, string> {
  return {
    "Content-Security-Policy": [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Nothing this application does needs any of these.
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    // Two years, subdomains included. Ignored by browsers over plain HTTP, and
    // correct the moment TLS terminates in front of the application.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  };
}

/**
 * Builds the forwarded response.
 *
 * Both identifiers go on the REQUEST, so Server Components can read them, and
 * the security headers on the RESPONSE. Public routes get the same treatment:
 * the sign-in form is exactly where a clickjacking or form-action attack would
 * be aimed, and `ThemeScript` runs there too.
 */
function forward(headers: Headers, pathname: string): NextResponse {
  const nonce = crypto.randomUUID().replaceAll("-", "");

  const requestHeaders = new Headers(headers);
  requestHeaders.set(PATHNAME_HEADER, pathname);
  requestHeaders.set(NONCE_HEADER, nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(name, value);
  }
  return response;
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

  if (isPublic(pathname)) return forward(req.headers, pathname);

  if (!req.auth) {
    const signInUrl = new URL("/login", req.nextUrl.origin);
    if (pathname !== "/") signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return forward(req.headers, pathname);
});

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
