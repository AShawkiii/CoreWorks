import { describe, expect, it } from "vitest";

import { CloseStageStatus, ReviewStatus } from "@/generated/prisma/enums";
import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import { buildMonthlyCloseId } from "@/lib/domain/ids";
import {
  buildCloseStages,
  computeCloseCompletion,
  computeCloseStatus,
} from "@/lib/domain/monthly-close";
import { CloseStatus } from "@/lib/domain/enums";
import {
  changeStageStatusSchema,
  closeListQuerySchema,
  openCloseSchema,
  requiredPeriodSchema,
  updateCloseSchema,
} from "@/lib/validation/monthly-close";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const CLOSE_ID = "22222222-2222-4222-8222-222222222222";
const STAGE_ID = "33333333-3333-4333-8333-333333333333";

describe("openCloseSchema", () => {
  it("requires a client and a period", () => {
    expect(
      openCloseSchema.safeParse({ clientId: CLIENT_ID, period: "2026-08" })
        .success,
    ).toBe(true);
    expect(
      openCloseSchema.safeParse({ clientId: "", period: "2026-08" }).success,
    ).toBe(false);
    expect(
      openCloseSchema.safeParse({ clientId: CLIENT_ID, period: "" }).success,
    ).toBe(false);
  });

  it("accepts no completion or status — both are derived", () => {
    const parsed = openCloseSchema.parse({
      clientId: CLIENT_ID,
      period: "2026-08",
      completionPct: 1,
      status: "CLOSED",
    });
    expect(parsed).not.toHaveProperty("completionPct");
    expect(parsed).not.toHaveProperty("status");
  });

  it("accepts no display id — it is composite, not supplied", () => {
    const parsed = openCloseSchema.parse({
      clientId: CLIENT_ID,
      period: "2026-08",
      displayId: "MC-EVIL-000000",
    });
    expect(parsed).not.toHaveProperty("displayId");
  });
});

describe("requiredPeriodSchema", () => {
  it("accepts every valid month", () => {
    for (let month = 1; month <= 12; month += 1) {
      const value = `2026-${String(month).padStart(2, "0")}`;
      expect(requiredPeriodSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it("rejects month 00, month 13, an unpadded month, and a blank", () => {
    for (const bad of ["2026-00", "2026-13", "2026-3", "", "Aug 2026"]) {
      expect(requiredPeriodSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("changeStageStatusSchema", () => {
  it("accepts every stage status — there is no transition table", () => {
    for (const status of Object.values(CloseStageStatus)) {
      expect(
        changeStageStatusSchema.safeParse({
          closeId: CLOSE_ID,
          stageId: STAGE_ID,
          status,
        }).success,
        status,
      ).toBe(true);
    }
  });

  it("rejects an unknown status or a missing id", () => {
    expect(
      changeStageStatusSchema.safeParse({
        closeId: CLOSE_ID,
        stageId: STAGE_ID,
        status: "DONE",
      }).success,
    ).toBe(false);
    expect(
      changeStageStatusSchema.safeParse({
        closeId: CLOSE_ID,
        status: CloseStageStatus.COMPLETED,
      }).success,
    ).toBe(false);
  });
});

describe("updateCloseSchema", () => {
  it("takes review status and notes only", () => {
    const parsed = updateCloseSchema.parse({
      closeId: CLOSE_ID,
      reviewStatus: ReviewStatus.APPROVED,
      notes: "  Signed off  ",
      completionPct: 1,
      status: "CLOSED",
    });
    expect(parsed.notes).toBe("Signed off");
    expect(parsed).not.toHaveProperty("completionPct");
    expect(parsed).not.toHaveProperty("status");
  });

  it("normalises empty notes to null", () => {
    const parsed = updateCloseSchema.parse({
      closeId: CLOSE_ID,
      reviewStatus: ReviewStatus.NOT_REVIEWED,
      notes: "",
    });
    expect(parsed.notes).toBeNull();
  });
});

describe("closeListQuerySchema", () => {
  it("defaults to page 1 with no filters", () => {
    const parsed = closeListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.status).toBeUndefined();
  });

  it("accepts the OPEN pseudo-status alongside real ones", () => {
    expect(closeListQuerySchema.parse({ status: "OPEN" }).status).toBe("OPEN");
    expect(closeListQuerySchema.parse({ status: "CLOSED" }).status).toBe(
      "CLOSED",
    );
    expect(closeListQuerySchema.safeParse({ status: "DONE" }).success).toBe(
      false,
    );
  });

  it("rejects a malformed period and page 0", () => {
    expect(closeListQuerySchema.safeParse({ period: "2026-13" }).success).toBe(
      false,
    );
    expect(closeListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });
});

describe("buildMonthlyCloseId", () => {
  it("matches the legacy composite format", () => {
    // Legacy: 'MC-' + clientId + '-' + period.replace('-', '')
    expect(buildMonthlyCloseId("CL-0007", "2026-08")).toBe("MC-CL-0007-202608");
    expect(buildMonthlyCloseId("CL-0001", "2026-12")).toBe("MC-CL-0001-202612");
  });

  it("strips only the first hyphen of the period, as legacy did", () => {
    // String.replace with a string pattern replaces the first match only —
    // the client id's own hyphen is untouched.
    expect(buildMonthlyCloseId("CL-0007", "2026-08")).toContain("CL-0007");
  });
});

describe("close stage arithmetic", () => {
  const stages = (statuses: CloseStageStatus[]) =>
    statuses.map((status, index) => ({
      stageName: MONTHLY_CLOSE_STAGES[index] ?? `Stage ${index}`,
      stageOrder: index,
      status,
    }));

  it("builds all eighteen stages Not Started, in order", () => {
    const built = buildCloseStages(MONTHLY_CLOSE_STAGES);
    expect(built).toHaveLength(18);
    expect(built.map((s) => s.stageName)).toEqual([...MONTHLY_CLOSE_STAGES]);
    expect(
      built.every((s) => s.status === CloseStageStatus.NOT_STARTED),
    ).toBe(true);
  });

  it("computes completion as completed over non-blank", () => {
    const half = stages([
      ...Array<CloseStageStatus>(9).fill(CloseStageStatus.COMPLETED),
      ...Array<CloseStageStatus>(9).fill(CloseStageStatus.NOT_STARTED),
    ]);
    expect(computeCloseCompletion(half)).toBeCloseTo(0.5, 10);
  });

  it("returns 0 for an empty stage list, as COUNTA=0 did", () => {
    expect(computeCloseCompletion([])).toBe(0);
    expect(computeCloseStatus([])).toBe(CloseStatus.NOT_STARTED);
  });

  it("checks Closed before Blocked", () => {
    const allDone = stages(
      Array<CloseStageStatus>(18).fill(CloseStageStatus.COMPLETED),
    );
    expect(computeCloseStatus(allDone)).toBe(CloseStatus.CLOSED);

    const oneBlocked = stages([
      ...Array<CloseStageStatus>(17).fill(CloseStageStatus.COMPLETED),
      CloseStageStatus.BLOCKED,
    ]);
    expect(computeCloseStatus(oneBlocked)).toBe(CloseStatus.BLOCKED);
  });

  it("ranks Blocked above In Progress", () => {
    const mixed = stages([
      CloseStageStatus.COMPLETED,
      CloseStageStatus.BLOCKED,
      ...Array<CloseStageStatus>(16).fill(CloseStageStatus.NOT_STARTED),
    ]);
    expect(computeCloseStatus(mixed)).toBe(CloseStatus.BLOCKED);
  });

  it("reads In Progress once anything is complete and nothing is blocked", () => {
    const started = stages([
      CloseStageStatus.COMPLETED,
      ...Array<CloseStageStatus>(17).fill(CloseStageStatus.NOT_STARTED),
    ]);
    expect(computeCloseStatus(started)).toBe(CloseStatus.IN_PROGRESS);
  });

  it("does not count Waiting Client or In Progress toward completion", () => {
    const busy = stages([
      CloseStageStatus.IN_PROGRESS,
      CloseStageStatus.WAITING_CLIENT,
      ...Array<CloseStageStatus>(16).fill(CloseStageStatus.NOT_STARTED),
    ]);
    expect(computeCloseCompletion(busy)).toBe(0);
    expect(computeCloseStatus(busy)).toBe(CloseStatus.NOT_STARTED);
  });
});
