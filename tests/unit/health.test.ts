import { describe, expect, it } from "vitest";

import { healthPayload } from "@/lib/health";

/**
 * The health payload (Phase 15).
 *
 * The body of this endpoint is public and unauthenticated, so what it must
 * *not* contain is as much the subject here as what it does.
 */

const NOW = new Date("2026-08-15T12:00:00.000Z");

describe("healthPayload", () => {
  it("reports ok with the uptime and the time", () => {
    expect(healthPayload(42.7, NOW)).toEqual({
      status: "ok",
      uptime: 42,
      time: "2026-08-15T12:00:00.000Z",
    });
  });

  it("floors the uptime rather than reporting a float", () => {
    // The reader is a load balancer, not a profiler.
    expect(healthPayload(0.9, NOW).uptime).toBe(0);
    expect(healthPayload(1.999, NOW).uptime).toBe(1);
  });

  it("carries a fresh timestamp, so a cached response is visible", () => {
    const later = new Date(NOW.getTime() + 60_000);
    expect(healthPayload(1, later).time).toBe("2026-08-15T12:01:00.000Z");
  });

  it("exposes exactly three fields and nothing else", () => {
    // A regression here is how configuration accidentally becomes public:
    // somebody adds "version" or "database" or "env" to a debug-friendly
    // payload on an endpoint that is open to the internet.
    expect(Object.keys(healthPayload(1, NOW)).sort()).toEqual([
      "status",
      "time",
      "uptime",
    ]);
  });

  it("contains nothing resembling configuration or a credential", () => {
    const serialised = JSON.stringify(healthPayload(1, NOW));

    for (const forbidden of [
      "postgres",
      "postgresql://",
      "secret",
      "password",
      "token",
      "DATABASE_URL",
      "AUTH_SECRET",
    ]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
