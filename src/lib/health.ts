/**
 * The health payload, as a pure function.
 *
 * Separated from the route so the *shape* — and specifically what it must
 * never contain — is testable without standing up a server.
 */

export interface HealthPayload {
  status: "ok";
  /** Seconds this process has been running. Distinguishes a restart loop from a stable instance. */
  uptime: number;
  /** ISO timestamp, so a cached response is obvious rather than silent. */
  time: string;
}

export function healthPayload(
  uptimeSeconds: number,
  now: Date,
): HealthPayload {
  return {
    status: "ok",
    // Whole seconds: the caller is a load balancer, not a profiler, and a
    // float here would just be noise in logs.
    uptime: Math.floor(uptimeSeconds),
    time: now.toISOString(),
  };
}
