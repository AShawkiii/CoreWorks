/**
 * Rate-limit arithmetic — pure, no I/O and no clock of its own.
 *
 * Closes the gap `security.md` has carried since Phase 2:
 *
 * > *"Rate limiting on sign-in and password reset."*
 *
 * A **fixed window** rather than a sliding log or a token bucket, chosen for
 * what it protects: credential stuffing against a small finance team, not a
 * public API under load. A fixed window is the one that can be reasoned about
 * from a single stored row — a count and the moment the window opened — which
 * matters because the store has to survive a restart without a background
 * sweep.
 *
 * Its known weakness is honest and acceptable here: an attacker who times
 * requests across a window boundary gets up to twice the limit in a short
 * burst. Against a 5-per-15-minutes sign-in budget that is ten attempts rather
 * than five, which changes nothing about whether a password survives.
 *
 * `now` is always a parameter. Every decision this module makes is a function
 * of the arguments, so the boundary cases are testable without waiting or
 * mocking a clock.
 */

export interface RateLimitRule {
  /** Attempts permitted inside one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitState {
  /** Attempts recorded in the current window. */
  count: number;
  /** When the current window opened. */
  windowStart: Date;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts left after this one. Zero when refused. */
  remaining: number;
  /** The state to persist. */
  next: RateLimitState;
  /** When the caller may try again. Only meaningful when refused. */
  retryAfter: Date;
}

/**
 * Sign-in: five attempts per fifteen minutes, per email AND per address.
 *
 * Five is above what a person mistypes in one sitting and far below what makes
 * a password list worth running. Fifteen minutes is short enough that a locked
 * -out colleague is not blocked for their afternoon.
 */
export const SIGN_IN_RULE: RateLimitRule = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
};

/**
 * Password reset: three per hour.
 *
 * Tighter than sign-in because each request is meant to send mail to a real
 * person; the limit is as much about not becoming a way to spam somebody's
 * inbox as about protecting the account.
 */
export const PASSWORD_RESET_RULE: RateLimitRule = {
  limit: 3,
  windowMs: 60 * 60 * 1000,
};

/**
 * Decides one attempt against the stored state.
 *
 * The count is incremented **whether or not the attempt is allowed**. That is
 * deliberate: an attacker who keeps trying past the limit extends their own
 * lockout rather than idling until the window rolls, which is what makes the
 * limit worth anything against an automated caller.
 */
export function checkRateLimit(
  state: RateLimitState | null,
  rule: RateLimitRule,
  now: Date,
): RateLimitDecision {
  const expired =
    state === null ||
    now.getTime() - state.windowStart.getTime() >= rule.windowMs;

  if (expired) {
    return {
      allowed: true,
      remaining: rule.limit - 1,
      next: { count: 1, windowStart: now },
      retryAfter: new Date(now.getTime() + rule.windowMs),
    };
  }

  const count = state.count + 1;
  const allowed = count <= rule.limit;

  return {
    allowed,
    remaining: allowed ? rule.limit - count : 0,
    next: { count, windowStart: state.windowStart },
    retryAfter: new Date(state.windowStart.getTime() + rule.windowMs),
  };
}

/** Whole seconds until `retryAfter`, for the header of the same name. */
export function retryAfterSeconds(decision: RateLimitDecision, now: Date): number {
  return Math.max(1, Math.ceil((decision.retryAfter.getTime() - now.getTime()) / 1000));
}

/**
 * A stable key for one subject of one rule.
 *
 * The value is lowercased and trimmed so `Alex@Example.com ` and
 * `alex@example.com` share a budget — otherwise varying the capitalisation
 * would reset the counter and the limit would protect nothing.
 */
export function rateLimitKey(
  scope: string,
  subject: string,
): string {
  return `${scope}:${subject.trim().toLowerCase()}`;
}

/**
 * How long a record stays interesting.
 *
 * Anything older than one window is decided as expired anyway, so a cleanup
 * pass can drop it. Exposed so the job and the checker agree on the boundary
 * rather than each choosing a number.
 */
export function isStale(
  state: RateLimitState,
  rule: RateLimitRule,
  now: Date,
): boolean {
  return now.getTime() - state.windowStart.getTime() >= rule.windowMs;
}
