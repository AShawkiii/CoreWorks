import { NextResponse } from "next/server";

import { healthPayload } from "@/lib/health";

/**
 * Liveness probe for the hosting platform (Phase 15).
 *
 * ---------------------------------------------------------------------------
 * It deliberately does NOT touch the database
 * ---------------------------------------------------------------------------
 *
 * This is the decision the phase brief asked to be made explicitly, and it
 * went the way it did for three reasons:
 *
 *  1. **A restart cannot fix a database outage.** Railway, Render and Fly all
 *     react to a failing health check by killing and replacing the instance.
 *     If this endpoint reported the database's health, a database blip would
 *     take down every application instance as well — and the replacements
 *     would come up, fail the same check, and be killed in turn. That converts
 *     a recoverable dependency failure into a restart loop.
 *
 *  2. **It is unauthenticated by necessity**, since a probe has no session.
 *     An unauthenticated endpoint that opens a database connection on demand
 *     is a free amplification vector: a few requests a second from anywhere on
 *     the internet, each consuming a connection from a pool sized for real
 *     users.
 *
 *  3. **Database reachability is already gated at deploy time.** The documented
 *     sequence runs `prisma migrate deploy` before the application starts, so a
 *     deployment that cannot reach the database fails before it ever serves a
 *     request. `prisma migrate status` is the tool for checking afterwards, and
 *     it authenticates with `DATABASE_URL` rather than being open to the world.
 *
 * What this endpoint answers is precisely "is this process up and serving
 * HTTP", which is what a liveness probe is for. Readiness against dependencies
 * is a different question and is answered by the deploy sequence, not here.
 * `docs/deployment.md` §3 records this, including how to add a deeper check if
 * an operator decides they want one.
 *
 * No secret, no configuration value, and no error detail is included — the
 * body is three fields that are safe on a public URL.
 */

// Never prerendered, never cached: a health check that answers from the build
// would report a process that may no longer exist.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(): NextResponse {
  return NextResponse.json(healthPayload(process.uptime(), new Date()), {
    status: 200,
    headers: {
      // Belt and braces against any cache between here and the probe.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
