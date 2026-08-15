import { describe, expect, it } from "vitest";

import {
  ContractStatus,
  EntityType,
  Frequency,
  IssueSeverity,
  IssueStatus,
  Priority,
  RequestStatus,
  ReviewStatus,
  TaskCategory,
  TaskStatus,
} from "@/generated/prisma/enums";
import {
  CLIENT_HEALTH_LABELS,
  CLOSE_STAGE_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  FREQUENCY_LABELS,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  PRIORITY_LABELS,
  REQUEST_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/domain/labels";
import {
  ENTITY_TYPE_LABELS,
  REPORTING_FREQUENCY_LABELS,
  formatLegacyDate,
  formatLegacyPercent,
  formatYesNo,
  parseClientHealth,
  parseCloseStageStatus,
  parseContractStatus,
  parseEntityType,
  parseFrequency,
  parseIssueSeverity,
  parseIssueStatus,
  parseLegacyDate,
  parseLegacyInt,
  parseLegacyPercent,
  parseLegacyPeriod,
  parsePriority,
  parseReportingFrequency,
  parseRequestStatus,
  parseReviewStatus,
  parseTaskCategory,
  parseTaskStatus,
  parseText,
  parseYesNo,
} from "@/lib/domain/legacy-values";

/**
 * The rule under test throughout, from migration-plan §4:
 *
 * > *"Enum values validate against audit §5. An unrecognized value is a
 * > rejection, never a silent coercion."*
 *
 * Every parser must return null for anything it does not recognise. A default
 * fallback is how a migration quietly marks forty tasks Not Started because
 * their status column had a trailing space.
 */

describe("enum parsers round-trip every label", () => {
  const cases = [
    ["TaskStatus", TASK_STATUS_LABELS, parseTaskStatus],
    ["Priority", PRIORITY_LABELS, parsePriority],
    ["ClientHealth", CLIENT_HEALTH_LABELS, parseClientHealth],
    ["ContractStatus", CONTRACT_STATUS_LABELS, parseContractStatus],
    ["RequestStatus", REQUEST_STATUS_LABELS, parseRequestStatus],
    ["IssueSeverity", ISSUE_SEVERITY_LABELS, parseIssueSeverity],
    ["IssueStatus", ISSUE_STATUS_LABELS, parseIssueStatus],
    ["ReviewStatus", REVIEW_STATUS_LABELS, parseReviewStatus],
    ["Frequency", FREQUENCY_LABELS, parseFrequency],
    ["TaskCategory", TASK_CATEGORY_LABELS, parseTaskCategory],
    ["CloseStageStatus", CLOSE_STAGE_STATUS_LABELS, parseCloseStageStatus],
    ["ReportingFrequency", REPORTING_FREQUENCY_LABELS, parseReportingFrequency],
  ] as const;

  for (const [name, labels, parse] of cases) {
    it(`${name}: every label parses back to its own value`, () => {
      // This is what makes CSV a real rollback path rather than a lossy one:
      // export writes the label, import reads it back to the same enum.
      for (const [value, label] of Object.entries(labels)) {
        expect(parse(label as string), `${name}.${value}`).toBe(value);
      }
    });

    it(`${name}: forgives case and whitespace only`, () => {
      const [firstValue, firstLabel] = Object.entries(labels)[0] as [
        string,
        string,
      ];
      expect(parse(`  ${firstLabel.toUpperCase()}  `)).toBe(firstValue);
    });

    it(`${name}: rejects an unknown value rather than defaulting`, () => {
      expect(parse("definitely-not-a-value")).toBeNull();
      expect(parse("")).toBeNull();
      expect(parse("   ")).toBeNull();
    });
  }
});

describe("specific enum values from audit §5", () => {
  it("reads the legacy task statuses", () => {
    expect(parseTaskStatus("Not Started")).toBe(TaskStatus.NOT_STARTED);
    expect(parseTaskStatus("Waiting Client")).toBe(TaskStatus.WAITING_CLIENT);
    expect(parseTaskStatus("In Review")).toBe(TaskStatus.IN_REVIEW);
  });

  it("does not confuse the two 'In Progress' enums", () => {
    // TaskStatus, IssueStatus, and CloseStageStatus all have one.
    expect(parseTaskStatus("In Progress")).toBe(TaskStatus.IN_PROGRESS);
    expect(parseIssueStatus("In Progress")).toBe(IssueStatus.IN_PROGRESS);
  });

  it("reads the legacy priorities and severities", () => {
    expect(parsePriority("Critical")).toBe(Priority.CRITICAL);
    expect(parseIssueSeverity("Critical")).toBe(IssueSeverity.CRITICAL);
  });

  it("reads One-Time with its hyphen", () => {
    expect(parseFrequency("One-Time")).toBe(Frequency.ONE_TIME);
    expect(parseFrequency("One Time")).toBeNull();
  });

  it("reads Ad-Hoc with its hyphen", () => {
    expect(parseTaskCategory("Ad-Hoc")).toBe(TaskCategory.AD_HOC);
  });

  it("reads the contract and request statuses", () => {
    expect(parseContractStatus("On Hold")).toBe(ContractStatus.ON_HOLD);
    expect(parseRequestStatus("Partially Received")).toBe(
      RequestStatus.PARTIALLY_RECEIVED,
    );
    expect(parseRequestStatus("Not Available")).toBe(
      RequestStatus.NOT_AVAILABLE,
    );
  });

  it("reads Changes Requested", () => {
    expect(parseReviewStatus("Changes Requested")).toBe(
      ReviewStatus.CHANGES_REQUESTED,
    );
  });
});

describe("parseEntityType", () => {
  it("reads the free-text forms legacy wrote", () => {
    expect(parseEntityType("Client")).toBe(EntityType.CLIENT);
    expect(parseEntityType("Task")).toBe(EntityType.TASK);
    expect(parseEntityType("Client Request")).toBe(EntityType.CLIENT_REQUEST);
    expect(parseEntityType("Issue")).toBe(EntityType.ISSUE);
  });

  it("also reads the enum spelling", () => {
    expect(parseEntityType("CLIENT_REQUEST")).toBe(EntityType.CLIENT_REQUEST);
    expect(parseEntityType("monthly close")).toBe(EntityType.MONTHLY_CLOSE);
  });

  it("labels every entity type", () => {
    for (const type of Object.values(EntityType)) {
      expect(ENTITY_TYPE_LABELS[type], type).toBeTruthy();
      expect(parseEntityType(ENTITY_TYPE_LABELS[type]), type).toBe(type);
    }
  });

  it("rejects an unknown type", () => {
    expect(parseEntityType("Spreadsheet")).toBeNull();
    expect(parseEntityType("")).toBeNull();
  });
});

describe("parseYesNo", () => {
  it("reads the Yes/No legacy wrote everywhere", () => {
    expect(parseYesNo("Yes")).toBe(true);
    expect(parseYesNo("No")).toBe(false);
    expect(parseYesNo("  yes  ")).toBe(true);
  });

  it("accepts the forms a checkbox column exports", () => {
    expect(parseYesNo("TRUE")).toBe(true);
    expect(parseYesNo("FALSE")).toBe(false);
    expect(parseYesNo("1")).toBe(true);
    expect(parseYesNo("0")).toBe(false);
  });

  it("returns null for blank and for nonsense — never false", () => {
    // Returning false would silently deactivate every employee whose Active?
    // cell was empty.
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo("maybe")).toBeNull();
    expect(parseYesNo("2")).toBeNull();
  });

  it("round-trips through formatYesNo", () => {
    expect(parseYesNo(formatYesNo(true))).toBe(true);
    expect(parseYesNo(formatYesNo(false))).toBe(false);
    expect(formatYesNo(null)).toBe("");
  });
});

describe("parseLegacyDate", () => {
  it("reads the ISO form legacy wrote", () => {
    const parsed = parseLegacyDate("2025-11-01");
    expect(parsed?.toISOString()).toBe("2025-11-01T00:00:00.000Z");
  });

  it("reads an ISO timestamp and keeps the date", () => {
    expect(parseLegacyDate("2025-11-01T14:20:00Z")?.toISOString()).toBe(
      "2025-11-01T00:00:00.000Z",
    );
    expect(parseLegacyDate("2025-11-01 14:20")?.toISOString()).toBe(
      "2025-11-01T00:00:00.000Z",
    );
  });

  it("builds in UTC so a due date does not shift a day", () => {
    expect(parseLegacyDate("2026-01-01")?.getUTCDate()).toBe(1);
    expect(parseLegacyDate("2026-01-01")?.getUTCMonth()).toBe(0);
  });

  it("REFUSES ambiguous day-first and month-first formats", () => {
    // 03/04/2026 is the 3rd of April in one locale and the 4th of March in
    // another, and nothing in a CSV says which. Guessing would move deadlines
    // by up to eleven months.
    for (const ambiguous of [
      "03/04/2026",
      "3/4/2026",
      "04-03-2026",
      "March 4, 2026",
      "4 Mar 2026",
    ]) {
      expect(parseLegacyDate(ambiguous), ambiguous).toBeNull();
    }
  });

  it("rejects an impossible date rather than rolling it forward", () => {
    // new Date(2026, 1, 31) silently becomes the 3rd of March.
    expect(parseLegacyDate("2026-02-31")).toBeNull();
    expect(parseLegacyDate("2026-13-01")).toBeNull();
    expect(parseLegacyDate("2026-00-01")).toBeNull();
    expect(parseLegacyDate("2026-01-32")).toBeNull();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseLegacyDate("2024-02-29")).not.toBeNull();
    expect(parseLegacyDate("2025-02-29")).toBeNull();
  });

  it("returns null for blank", () => {
    expect(parseLegacyDate("")).toBeNull();
    expect(parseLegacyDate("   ")).toBeNull();
  });

  it("round-trips through formatLegacyDate", () => {
    const original = "2026-08-15";
    expect(formatLegacyDate(parseLegacyDate(original))).toBe(original);
    expect(formatLegacyDate(null)).toBe("");
  });
});

describe("parseLegacyInt", () => {
  it("reads whole numbers including negatives and zero", () => {
    expect(parseLegacyInt("18")).toBe(18);
    expect(parseLegacyInt("0")).toBe(0);
    expect(parseLegacyInt("-3")).toBe(-3);
    expect(parseLegacyInt("  7  ")).toBe(7);
  });

  it("returns null rather than zero for blank or nonsense", () => {
    // Zero is a valid capacity, so coercing a blank to it would be a lie.
    expect(parseLegacyInt("")).toBeNull();
    expect(parseLegacyInt("many")).toBeNull();
    expect(parseLegacyInt("3.5")).toBeNull();
    expect(parseLegacyInt("1e3")).toBeNull();
  });
});

describe("parseLegacyPercent", () => {
  it("reads a stored fraction, as legacy held it", () => {
    expect(parseLegacyPercent("0.45")).toBeCloseTo(0.45, 10);
    expect(parseLegacyPercent("0")).toBe(0);
    expect(parseLegacyPercent("1")).toBe(1);
  });

  it("reads a percentage-formatted cell", () => {
    expect(parseLegacyPercent("45%")).toBeCloseTo(0.45, 10);
    expect(parseLegacyPercent("100%")).toBe(1);
  });

  it("reads a bare number above 1 as a percentage", () => {
    // The ranges cannot overlap: a stored fraction is never above 1.
    expect(parseLegacyPercent("45")).toBeCloseTo(0.45, 10);
    expect(parseLegacyPercent("100")).toBe(1);
  });

  it("rejects out of range and nonsense", () => {
    expect(parseLegacyPercent("101")).toBeNull();
    expect(parseLegacyPercent("150%")).toBeNull();
    expect(parseLegacyPercent("-5")).toBeNull();
    expect(parseLegacyPercent("half")).toBeNull();
    expect(parseLegacyPercent("")).toBeNull();
  });

  it("round-trips as the fraction legacy stored", () => {
    expect(formatLegacyPercent(0.45)).toBe("0.45");
    expect(parseLegacyPercent(formatLegacyPercent(0.45))).toBeCloseTo(0.45, 10);
    expect(formatLegacyPercent(null)).toBe("");
  });
});

describe("parseLegacyPeriod", () => {
  it("reads YYYY-MM", () => {
    expect(parseLegacyPeriod("2026-08")).toBe("2026-08");
  });

  it("truncates a full date, as a month cell often holds one", () => {
    expect(parseLegacyPeriod("2026-08-01")).toBe("2026-08");
    expect(parseLegacyPeriod("2026-08-01T00:00:00Z")).toBe("2026-08");
  });

  it("rejects an impossible or unpadded month", () => {
    expect(parseLegacyPeriod("2026-13")).toBeNull();
    expect(parseLegacyPeriod("2026-00")).toBeNull();
    expect(parseLegacyPeriod("2026-8")).toBeNull();
    expect(parseLegacyPeriod("Aug 2026")).toBeNull();
    expect(parseLegacyPeriod("")).toBeNull();
  });
});

describe("parseText", () => {
  it("trims, and turns blank into null", () => {
    expect(parseText("  hello  ")).toBe("hello");
    expect(parseText("")).toBeNull();
    expect(parseText("   ")).toBeNull();
  });
});
