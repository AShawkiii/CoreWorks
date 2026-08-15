import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitKey,
  retryAfterSeconds,
  type RateLimitDecision,
  type RateLimitRule,
} from "@/lib/domain/rate-limit";

/**
 * Rate limiting, backed by PostgreSQL.
 *
 * The arithmetic is pure and lives in `lib/domain/rate-limit.ts`; this is the
 * storage and the failure policy.
 *
 * **Stored in the database, not in memory.** A per-process counter gives an
 * attacker one budget per instance, and any real deployment runs more than
 * one. It also has to survive a restart — which is precisely the moment an
 * attacker would prefer it did not.
 */

export interface LimitResult extends RateLimitDecision {
  /** Whole seconds until the caller may retry. */
  retryAfterSeconds: number;
}

/**
 * Records an attempt and decides it.
 *
 * ---------------------------------------------------------------------------
 * Failing OPEN, deliberately
 * ---------------------------------------------------------------------------
 *
 * If the database is unreachable this **allows** the attempt. That is the
 * opposite of the fail-closed rule the rest of the codebase follows, and it is
 * a considered exception:
 *
 *  - Sign-in cannot succeed without the database anyway — `authorize` has to
 *    read the user — so failing open here grants nothing.
 *  - Failing closed would turn a database blip into a total sign-in outage for
 *    every user, which is a self-inflicted denial of service far more likely to
 *    occur than the attack this defends against.
 *
 * The error is logged rather than swallowed silently, so a limiter that has
 * stopped working is visible rather than merely ineffective.
 */
export async function consumeRateLimit(
  scope: string,
  subject: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<LimitResult> {
  const key = rateLimitKey(scope, subject);

  try {
    const existing = await prisma.rateLimit.findUnique({
      where: { key },
      select: { count: true, windowStart: true },
    });

    const decision = checkRateLimit(existing, rule, now);

    await prisma.rateLimit.upsert({
      where: { key },
      create: {
        key,
        count: decision.next.count,
        windowStart: decision.next.windowStart,
      },
      update: {
        count: decision.next.count,
        windowStart: decision.next.windowStart,
      },
    });

    return { ...decision, retryAfterSeconds: retryAfterSeconds(decision, now) };
  } catch (error) {
    console.error("[rate-limit] store unavailable, allowing attempt", error);
    const open = checkRateLimit(null, rule, now);
    return { ...open, retryAfterSeconds: 0 };
  }
}

/**
 * Clears a subject's counter.
 *
 * Called after a **successful** sign-in: someone who mistyped their password
 * three times and then got it right should not carry two remaining attempts
 * into their next session. A failed attempt never clears anything.
 */
export async function clearRateLimit(
  scope: string,
  subject: string,
): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({
      where: { key: rateLimitKey(scope, subject) },
    });
  } catch (error) {
    console.error("[rate-limit] could not clear", error);
  }
}

/**
 * Drops counters whose window closed long ago.
 *
 * Nothing depends on this for correctness — an expired row is decided as
 * expired whether or not it still exists — so it is housekeeping, run by the
 * daily job rather than on the request path.
 */
export async function pruneRateLimits(
  olderThan: Date,
): Promise<number> {
  const result = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: olderThan } },
  });
  return result.count;
}
