import { describe, expect, it } from "vitest";

import {
  buildMonthlyCloseId,
  formatDisplayId,
  ID_FORMATS,
  parseDisplayId,
} from "@/lib/domain/ids";

/**
 * Display-ID formats must match legacy exactly (audit §4) — these IDs appear
 * in client correspondence, so a format change would break continuity.
 */
describe("formatDisplayId", () => {
  it("pads each entity to its legacy width", () => {
    expect(formatDisplayId("CLIENT", 7)).toBe("CL-0007");
    expect(formatDisplayId("MEMBER", 12)).toBe("EMP-012");
    expect(formatDisplayId("TASK", 4321)).toBe("TSK-004321");
    expect(formatDisplayId("TASK_TEMPLATE", 14)).toBe("TPL-014");
    expect(formatDisplayId("CLIENT_REQUEST", 88)).toBe("REQ-0088");
    expect(formatDisplayId("ISSUE", 21)).toBe("ISS-0021");
    expect(formatDisplayId("ACTIVITY", 1234)).toBe("ACT-0001234");
    expect(formatDisplayId("SERVICE", 14)).toBe("SVC-014");
    expect(formatDisplayId("SERVICE_PACKAGE", 3)).toBe("PKG-003");
  });

  it("starts at 1, matching legacy nextSequentialId on an empty sheet", () => {
    expect(formatDisplayId("CLIENT", 1)).toBe("CL-0001");
  });

  it("does not truncate a value wider than its pad width", () => {
    // Legacy padded but never truncated; a 5-digit client count must still
    // produce a usable ID rather than a corrupted one.
    expect(formatDisplayId("CLIENT", 12345)).toBe("CL-12345");
  });
});

describe("parseDisplayId", () => {
  it("round-trips every entity format", () => {
    for (const entity of Object.keys(ID_FORMATS) as (keyof typeof ID_FORMATS)[]) {
      expect(parseDisplayId(entity, formatDisplayId(entity, 42))).toBe(42);
    }
  });

  it("ignores IDs that do not match the expected shape", () => {
    // Legacy skipped malformed IDs so a stray row could not corrupt numbering.
    expect(parseDisplayId("CLIENT", "CLIENT-0007")).toBeNull();
    expect(parseDisplayId("CLIENT", "CL-00A7")).toBeNull();
    expect(parseDisplayId("CLIENT", "CL-")).toBeNull();
    expect(parseDisplayId("CLIENT", "")).toBeNull();
    expect(parseDisplayId("CLIENT", "TSK-000001")).toBeNull();
  });

  it("does not confuse a longer prefix for a shorter one", () => {
    expect(parseDisplayId("SERVICE", "SVC-014")).toBe(14);
    expect(parseDisplayId("SERVICE_PACKAGE", "SVC-014")).toBeNull();
  });
});

describe("buildMonthlyCloseId", () => {
  it("matches the legacy composite format", () => {
    // Legacy: 'MC-' + clientId + '-' + period.replace('-', '')
    expect(buildMonthlyCloseId("CL-0007", "2026-08")).toBe("MC-CL-0007-202608");
  });

  it("strips only the period separator, not the client prefix hyphen", () => {
    const id = buildMonthlyCloseId("CL-0001", "2026-12");
    expect(id).toBe("MC-CL-0001-202612");
    expect(id).toContain("CL-0001");
  });
});
