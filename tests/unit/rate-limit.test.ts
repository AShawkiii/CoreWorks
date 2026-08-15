import { describe, expect, it } from "vitest";

import {
  PASSWORD_RESET_RULE,
  SIGN_IN_RULE,
  checkRateLimit,
  isStale,
  rateLimitKey,
  retryAfterSeconds,
  type RateLimitRule,
  type RateLimitState,
} from "@/lib/domain/rate-limit";

/**
 * The rate-limit arithmetic, closing the gap `security.md` carried from
 * Phase 2. Every decision is a function of its arguments, so the boundaries
 * are testable without waiting or mocking a clock.
 */

const RULE: RateLimitRule = { limit: 3, windowMs: 60_000 };
const T0 = new Date("2026-08-15T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("checkRateLimit", () => {
  it("allows the first attempt and opens a window", () => {
    const decision = checkRateLimit(null, RULE, T0);

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(2);
    expect(decision.next).toEqual({ count: 1, windowStart: T0 });
  });

  it("allows exactly `limit` attempts and refuses the next", () => {
    let state: RateLimitState | null = null;
    const outcomes: boolean[] = [];

    for (let i = 0; i < 5; i += 1) {
      const decision = checkRateLimit(state, RULE, at(i * 1000));
      outcomes.push(decision.allowed);
      state = decision.next;
    }

    expect(outcomes).toEqual([true, true, true, false, false]);
  });

  it("counts a REFUSED attempt too", () => {
    // An attacker who keeps trying past the limit extends their own lockout
    // rather than idling until the window rolls. Without this the limit is
    // trivially defeated by continuing to hammer.
    const state: RateLimitState = { count: 3, windowStart: T0 };

    const first = checkRateLimit(state, RULE, at(1000));
    expect(first.allowed).toBe(false);
    expect(first.next.count).toBe(4);

    const second = checkRateLimit(first.next, RULE, at(2000));
    expect(second.next.count).toBe(5);
  });

  it("does NOT extend the window when a refused attempt is counted", () => {
    // The count grows but the window keeps its original start, so the lockout
    // still ends on schedule. Sliding the start would let an attacker keep a
    // colleague locked out indefinitely.
    const state: RateLimitState = { count: 9, windowStart: T0 };
    const decision = checkRateLimit(state, RULE, at(30_000));

    expect(decision.next.windowStart).toEqual(T0);
    expect(decision.retryAfter).toEqual(at(60_000));
  });

  it("opens a fresh window once the old one has elapsed", () => {
    const exhausted: RateLimitState = { count: 99, windowStart: T0 };

    const decision = checkRateLimit(exhausted, RULE, at(RULE.windowMs));
    expect(decision.allowed).toBe(true);
    expect(decision.next).toEqual({ count: 1, windowStart: at(RULE.windowMs) });
  });

  it("treats the boundary as elapsed, not as still inside", () => {
    const exhausted: RateLimitState = { count: 99, windowStart: T0 };

    // One millisecond before: still refused.
    expect(checkRateLimit(exhausted, RULE, at(RULE.windowMs - 1)).allowed).toBe(
      false,
    );
    // Exactly on: allowed.
    expect(checkRateLimit(exhausted, RULE, at(RULE.windowMs)).allowed).toBe(true);
  });

  it("reports remaining as zero when refused, never negative", () => {
    const state: RateLimitState = { count: 50, windowStart: T0 };
    const decision = checkRateLimit(state, RULE, at(1000));

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("reports retryAfter as the end of the current window", () => {
    const state: RateLimitState = { count: 3, windowStart: T0 };
    const decision = checkRateLimit(state, RULE, at(10_000));

    expect(decision.retryAfter).toEqual(at(RULE.windowMs));
  });

  it("handles a clock that appears to go backwards", () => {
    // NTP correction, or two servers disagreeing. The elapsed comparison is
    // negative, so the window is treated as still open — which is the safe
    // direction: it refuses rather than resetting the counter.
    const state: RateLimitState = { count: 3, windowStart: at(60_000) };
    const decision = checkRateLimit(state, RULE, T0);

    expect(decision.allowed).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up and never returns zero", () => {
    const state: RateLimitState = { count: 3, windowStart: T0 };
    const decision = checkRateLimit(state, RULE, at(59_500));

    // 500ms remaining rounds to 1, not 0 — a Retry-After of zero invites an
    // immediate retry that would also fail.
    expect(retryAfterSeconds(decision, at(59_500))).toBe(1);
  });

  it("reports the whole window when the attempt is the first refusal", () => {
    const state: RateLimitState = { count: 3, windowStart: T0 };
    const decision = checkRateLimit(state, RULE, T0);

    expect(retryAfterSeconds(decision, T0)).toBe(60);
  });
});

describe("rateLimitKey", () => {
  it("normalises case and whitespace so a budget cannot be dodged", () => {
    // Varying the capitalisation would otherwise reset the counter and the
    // limit would protect nothing.
    expect(rateLimitKey("signin", "  Alex@Example.com ")).toBe(
      "signin:alex@example.com",
    );
    expect(rateLimitKey("signin", "ALEX@EXAMPLE.COM")).toBe(
      rateLimitKey("signin", "alex@example.com"),
    );
  });

  it("keeps different scopes apart", () => {
    expect(rateLimitKey("signin", "a@b.c")).not.toBe(
      rateLimitKey("reset", "a@b.c"),
    );
  });
});

describe("isStale", () => {
  it("is true only once the window has fully elapsed", () => {
    const state: RateLimitState = { count: 1, windowStart: T0 };

    expect(isStale(state, RULE, at(RULE.windowMs - 1))).toBe(false);
    expect(isStale(state, RULE, at(RULE.windowMs))).toBe(true);
  });
});

describe("the configured rules", () => {
  it("sign-in: five attempts per fifteen minutes", () => {
    expect(SIGN_IN_RULE).toEqual({ limit: 5, windowMs: 15 * 60 * 1000 });
  });

  it("password reset is tighter than sign-in", () => {
    // Each reset is meant to send mail to a real person, so the limit is as
    // much about not becoming a way to spam an inbox.
    expect(PASSWORD_RESET_RULE.limit).toBeLessThan(SIGN_IN_RULE.limit);
    expect(PASSWORD_RESET_RULE.windowMs).toBeGreaterThan(SIGN_IN_RULE.windowMs);
  });

  it("both rules permit at least one attempt", () => {
    for (const rule of [SIGN_IN_RULE, PASSWORD_RESET_RULE]) {
      expect(checkRateLimit(null, rule, T0).allowed).toBe(true);
    }
  });

  it("sign-in refuses the sixth attempt in a window", () => {
    let state: RateLimitState | null = null;
    for (let i = 0; i < 5; i += 1) {
      state = checkRateLimit(state, SIGN_IN_RULE, at(i * 1000)).next;
    }
    expect(checkRateLimit(state, SIGN_IN_RULE, at(6000)).allowed).toBe(false);
  });
});
