import { describe, expect, it } from "vitest";

import { IssueSeverity, IssueStatus } from "@/generated/prisma/enums";
import {
  changeIssueStatusSchema,
  createIssueSchema,
  issueListQuerySchema,
  updateIssueSchema,
} from "@/lib/validation/issue";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const ISSUE_ID = "33333333-3333-4333-8333-333333333333";

const valid = {
  clientId: CLIENT_ID,
  title: "VAT return figures do not reconcile",
  category: "Reconciliation",
  impact: "Cannot file until resolved.",
  description: "",
  severity: IssueSeverity.HIGH,
  assignedToId: MEMBER_ID,
  dateRaised: "2026-08-01",
  deadline: "2026-08-20",
  requiredAction: "Client to supply bank statements.",
  notes: "",
};

describe("createIssueSchema", () => {
  it("accepts a well-formed issue", () => {
    expect(createIssueSchema.safeParse(valid).success).toBe(true);
  });

  it("requires the two legacy-mandatory fields", () => {
    // Legacy createIssue: Client ID and Issue.
    expect(
      createIssueSchema.safeParse({ ...valid, clientId: "" }).success,
    ).toBe(false);
    expect(createIssueSchema.safeParse({ ...valid, title: " " }).success).toBe(
      false,
    );
  });

  it("does not require a deadline, category, or assignee", () => {
    const parsed = createIssueSchema.parse({
      ...valid,
      category: "",
      deadline: "",
      assignedToId: "",
    });
    expect(parsed.category).toBeNull();
    expect(parsed.deadline).toBeNull();
    expect(parsed.assignedToId).toBeNull();
  });

  it("does not accept a status — creation status is a service decision", () => {
    const parsed = createIssueSchema.parse({
      ...valid,
      status: IssueStatus.RESOLVED,
    });
    expect(parsed).not.toHaveProperty("status");
  });

  it("trims the title and normalises empty text to null", () => {
    const parsed = createIssueSchema.parse({
      ...valid,
      title: "  Spacing  ",
      description: "",
      notes: "",
    });
    expect(parsed.title).toBe("Spacing");
    expect(parsed.description).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("keeps the legacy Impact field alongside the net-new description", () => {
    const parsed = createIssueSchema.parse(valid);
    expect(parsed.impact).toBe("Cannot file until resolved.");
    expect(parsed).toHaveProperty("description");
  });

  it("rejects an unknown severity", () => {
    expect(
      createIssueSchema.safeParse({ ...valid, severity: "SHOWSTOPPER" }).success,
    ).toBe(false);
  });

  it("enforces the title length bounds", () => {
    expect(createIssueSchema.safeParse({ ...valid, title: "A" }).success).toBe(
      false,
    );
    expect(
      createIssueSchema.safeParse({ ...valid, title: "A".repeat(201) }).success,
    ).toBe(false);
    expect(
      createIssueSchema.safeParse({ ...valid, title: "A".repeat(200) }).success,
    ).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(
      createIssueSchema.safeParse({ ...valid, deadline: "20-08-2026" }).success,
    ).toBe(false);
  });
});

describe("updateIssueSchema", () => {
  it("requires an issue id", () => {
    expect(updateIssueSchema.safeParse(valid).success).toBe(false);
    expect(
      updateIssueSchema.safeParse({ ...valid, issueId: ISSUE_ID }).success,
    ).toBe(true);
  });

  it("carries no status field — status moves through its own action", () => {
    const parsed = updateIssueSchema.parse({
      ...valid,
      issueId: ISSUE_ID,
      status: IssueStatus.RESOLVED,
    });
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("changeIssueStatusSchema", () => {
  it("accepts every known status — issues have no transition table", () => {
    for (const status of Object.values(IssueStatus)) {
      expect(
        changeIssueStatusSchema.safeParse({ issueId: ISSUE_ID, status }).success,
        status,
      ).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(
      changeIssueStatusSchema.safeParse({ issueId: ISSUE_ID, status: "DONE" })
        .success,
    ).toBe(false);
  });

  it("accepts an optional resolution date, as legacy resolveIssue did", () => {
    const parsed = changeIssueStatusSchema.parse({
      issueId: ISSUE_ID,
      status: IssueStatus.RESOLVED,
      resolutionDate: "2026-08-15",
    });
    expect(parsed.resolutionDate).toBeInstanceOf(Date);

    const blank = changeIssueStatusSchema.parse({
      issueId: ISSUE_ID,
      status: IssueStatus.RESOLVED,
    });
    expect(blank.resolutionDate).toBeUndefined();
  });
});

describe("issueListQuerySchema", () => {
  it("supplies defaults for an empty query", () => {
    const parsed = issueListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.sort).toBe("severity");
    expect(parsed.surfaced).toBe(false);
  });

  it("reads surfaced only from an explicit true token", () => {
    // z.coerce.boolean() would read "false" as true; this must not.
    expect(issueListQuerySchema.parse({ surfaced: "true" }).surfaced).toBe(true);
    expect(issueListQuerySchema.parse({ surfaced: "1" }).surfaced).toBe(true);
    expect(issueListQuerySchema.parse({ surfaced: "false" }).surfaced).toBe(
      false,
    );
    expect(issueListQuerySchema.parse({ surfaced: "" }).surfaced).toBe(false);
    expect(issueListQuerySchema.parse({ surfaced: "0" }).surfaced).toBe(false);
  });

  it("accepts the OPEN pseudo-status alongside real statuses", () => {
    expect(issueListQuerySchema.parse({ status: "OPEN" }).status).toBe("OPEN");
    expect(issueListQuerySchema.parse({ status: "ALL" }).status).toBe("ALL");
    expect(
      issueListQuerySchema.parse({ status: IssueStatus.IN_PROGRESS }).status,
    ).toBe(IssueStatus.IN_PROGRESS);
    expect(issueListQuerySchema.safeParse({ status: "OPENISH" }).success).toBe(
      false,
    );
  });

  it("accepts UNASSIGNED as an assignee filter", () => {
    expect(
      issueListQuerySchema.parse({ assignedToId: "UNASSIGNED" }).assignedToId,
    ).toBe("UNASSIGNED");
    expect(
      issueListQuerySchema.safeParse({ assignedToId: "someone" }).success,
    ).toBe(false);
  });

  it("rejects page 0 and an unknown sort key", () => {
    expect(issueListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(issueListQuerySchema.safeParse({ sort: "random" }).success).toBe(
      false,
    );
  });
});
