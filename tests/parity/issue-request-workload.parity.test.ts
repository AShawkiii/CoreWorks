import { describe, expect, it } from "vitest";

import { computeDaysWaiting } from "@/lib/domain/date";
import {
  IssueSeverity,
  IssueStatus,
  RequestStatus,
} from "@/lib/domain/enums";
import {
  isIssueOpen,
  isOverdueIssue,
  isUnresolvedCriticalOrHigh,
  selectSurfacedIssues,
} from "@/lib/domain/issue";
import {
  flagStaleRequests,
  isRequestOpen,
  topClientsByOutstandingRequests,
} from "@/lib/domain/request";
import type { DomainIssue, DomainRequest } from "@/lib/domain/types";
import { isOverloaded } from "@/lib/domain/workload";

import {
  d,
  ISSUE_STATUS_TO_LEGACY,
  makeIssue,
  makeRequest,
  REQUEST_STATUS_TO_LEGACY,
  toLegacyIssue,
  toLegacyRequest,
} from "./fixtures";
import { legacyFn, LEGACY_MODULES, loadLegacyContext } from "./legacy-context";

const TODAY = d("2026-08-15");

// ---------------------------------------------------------------------------
// Issues — audit §6.5
// ---------------------------------------------------------------------------

const issueCtx = loadLegacyContext([...LEGACY_MODULES.issueLogic]);

const legacyIsIssueOpen = legacyFn<(status: string) => boolean>(
  issueCtx,
  "isIssueOpen",
);
const legacyUnresolvedCritHigh = legacyFn<
  (issue: Record<string, unknown>) => boolean
>(issueCtx, "isUnresolvedCriticalOrHigh");
const legacyIsOverdueIssue = legacyFn<
  (issue: Record<string, unknown>, today: Date) => boolean
>(issueCtx, "isOverdueIssue");
const legacySelectSurfaced = legacyFn<
  (issues: Record<string, unknown>[], today: Date) => Record<string, unknown>[]
>(issueCtx, "selectSurfacedIssues");

describe("parity: isIssueOpen", () => {
  it.each(Object.values(IssueStatus))("%s", (status) => {
    expect(isIssueOpen(status)).toBe(
      legacyIsIssueOpen(ISSUE_STATUS_TO_LEGACY[status]),
    );
  });
});

describe("parity: issue predicates across the severity/status matrix", () => {
  for (const status of Object.values(IssueStatus)) {
    for (const severity of Object.values(IssueSeverity)) {
      const issue = makeIssue({ status, severity });

      it(`unresolvedCriticalOrHigh: ${status}/${severity}`, () => {
        expect(isUnresolvedCriticalOrHigh(issue)).toBe(
          legacyUnresolvedCritHigh(toLegacyIssue(issue)),
        );
      });

      for (const deadline of [null, d("2026-08-14"), d("2026-08-15"), d("2026-08-16")]) {
        it(`isOverdueIssue: ${status}/${severity}/deadline ${deadline?.toDateString() ?? "none"}`, () => {
          const withDeadline = makeIssue({ status, severity, deadline });
          expect(isOverdueIssue(withDeadline, TODAY)).toBe(
            legacyIsOverdueIssue(toLegacyIssue(withDeadline), TODAY),
          );
        });
      }
    }
  }
});

describe("parity: selectSurfacedIssues", () => {
  const scenarios: [string, DomainIssue[]][] = [
    ["no issues", []],
    [
      "no qualifying issues",
      [
        makeIssue({ severity: IssueSeverity.LOW, status: IssueStatus.OPEN }),
        makeIssue({ severity: IssueSeverity.MEDIUM, status: IssueStatus.OPEN }),
      ],
    ],
    [
      "resolved criticals are excluded",
      [
        makeIssue({
          displayId: "ISS-0001",
          severity: IssueSeverity.CRITICAL,
          status: IssueStatus.RESOLVED,
        }),
        makeIssue({
          displayId: "ISS-0002",
          severity: IssueSeverity.CRITICAL,
          status: IssueStatus.CANCELLED,
        }),
      ],
    ],
    [
      "severity ordering, then oldest first",
      [
        makeIssue({
          displayId: "ISS-A",
          severity: IssueSeverity.HIGH,
          dateRaised: d("2026-08-10"),
        }),
        makeIssue({
          displayId: "ISS-B",
          severity: IssueSeverity.CRITICAL,
          dateRaised: d("2026-08-12"),
        }),
        makeIssue({
          displayId: "ISS-C",
          severity: IssueSeverity.HIGH,
          dateRaised: d("2026-08-01"),
        }),
        makeIssue({
          displayId: "ISS-D",
          severity: IssueSeverity.CRITICAL,
          dateRaised: d("2026-08-02"),
        }),
      ],
    ],
    [
      "an overdue LOW issue still surfaces",
      [
        makeIssue({
          displayId: "ISS-LOW-OVERDUE",
          severity: IssueSeverity.LOW,
          status: IssueStatus.OPEN,
          deadline: d("2026-08-01"),
        }),
      ],
    ],
    [
      "an overdue issue that is also critical is not double-counted",
      [
        makeIssue({
          displayId: "ISS-BOTH",
          severity: IssueSeverity.CRITICAL,
          status: IssueStatus.OPEN,
          deadline: d("2026-08-01"),
        }),
      ],
    ],
    [
      "deadline exactly today is not yet overdue",
      [
        makeIssue({
          displayId: "ISS-TODAY",
          severity: IssueSeverity.LOW,
          status: IssueStatus.OPEN,
          deadline: TODAY,
        }),
      ],
    ],
  ];

  for (const [name, issues] of scenarios) {
    it(name, () => {
      const mine = selectSurfacedIssues(issues, TODAY).map((i) => i.displayId);
      const theirs = legacySelectSurfaced(
        issues.map(toLegacyIssue),
        TODAY,
      ).map((row) => row["Issue ID"]);
      expect(mine).toEqual(theirs);
    });
  }
});

// ---------------------------------------------------------------------------
// Requests — audit §6.8
// ---------------------------------------------------------------------------

const requestCtx = loadLegacyContext([...LEGACY_MODULES.requestLogic]);

const legacyIsRequestOpen = legacyFn<(status: string) => boolean>(
  requestCtx,
  "isRequestOpen",
);
const legacyFlagStale = legacyFn<
  (requests: Record<string, unknown>[], threshold: number) => string[]
>(requestCtx, "flagStaleRequests");
const legacyTopClients = legacyFn<
  (
    requests: Record<string, unknown>[],
    n: number,
  ) => { client: string; count: number }[]
>(requestCtx, "topClientsByOutstandingRequests");

describe("parity: isRequestOpen", () => {
  it.each(Object.values(RequestStatus))("%s", (status) => {
    expect(isRequestOpen(status)).toBe(
      legacyIsRequestOpen(REQUEST_STATUS_TO_LEGACY[status]),
    );
  });
});

describe("parity: flagStaleRequests", () => {
  const scenarios: [string, DomainRequest[]][] = [
    ["no requests", []],
    [
      "below, at, and beyond the 15-day threshold",
      [
        makeRequest({ displayId: "REQ-14", requestedDate: d("2026-08-01") }), // 14
        makeRequest({ displayId: "REQ-15", requestedDate: d("2026-07-31") }), // 15
        makeRequest({ displayId: "REQ-30", requestedDate: d("2026-07-16") }), // 30
      ],
    ],
    [
      "closed requests never count as stale",
      [
        makeRequest({
          displayId: "REQ-RECEIVED",
          status: RequestStatus.RECEIVED,
          requestedDate: d("2026-01-01"),
          receivedDate: d("2026-01-05"),
        }),
        makeRequest({
          displayId: "REQ-CANCELLED",
          status: RequestStatus.CANCELLED,
          requestedDate: d("2026-01-01"),
        }),
      ],
    ],
    [
      "partially received still ages",
      [
        makeRequest({
          displayId: "REQ-PARTIAL",
          status: RequestStatus.PARTIALLY_RECEIVED,
          requestedDate: d("2026-07-01"),
        }),
      ],
    ],
  ];

  for (const [name, requests] of scenarios) {
    it(name, () => {
      const mine = flagStaleRequests(requests, 15, TODAY);

      const legacyRows = requests.map((request) =>
        toLegacyRequest(
          request,
          computeDaysWaiting(
            request.requestedDate,
            request.status,
            TODAY,
            request.receivedDate,
          ),
        ),
      );
      const theirs = legacyFlagStale(legacyRows, 15);

      // Legacy returns display ids; the port returns internal ids.
      const mineDisplay = requests
        .filter((request) => mine.includes(request.id))
        .map((request) => request.displayId);
      expect(mineDisplay).toEqual(theirs);
    });
  }
});

describe("parity: topClientsByOutstandingRequests", () => {
  const requests = [
    makeRequest({ clientName: "Alpha", status: RequestStatus.REQUESTED }),
    makeRequest({ clientName: "Alpha", status: RequestStatus.REQUESTED }),
    makeRequest({ clientName: "Alpha", status: RequestStatus.RECEIVED }),
    makeRequest({ clientName: "Beta", status: RequestStatus.PARTIALLY_RECEIVED }),
    makeRequest({ clientName: "Gamma", status: RequestStatus.CANCELLED }),
  ];

  it("counts only open requests, descending", () => {
    const mine = topClientsByOutstandingRequests(requests, 5);
    const theirs = legacyTopClients(
      requests.map((request) => toLegacyRequest(request, 0)),
      5,
    );

    expect(mine.map((row) => [row.clientName, row.count])).toEqual(
      theirs.map((row) => [row.client, row.count]),
    );
  });

  it("returns nothing when every request is closed", () => {
    const closed = [
      makeRequest({ clientName: "Alpha", status: RequestStatus.RECEIVED }),
    ];
    expect(topClientsByOutstandingRequests(closed, 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Workload — audit §6.7
// ---------------------------------------------------------------------------

const workloadCtx = loadLegacyContext([...LEGACY_MODULES.workloadLogic]);
const legacyIsOverloaded = legacyFn<
  (open: number, capacity: number | "", margin: number) => boolean
>(workloadCtx, "isOverloaded");

describe("parity: isOverloaded", () => {
  const openCounts = [0, 1, 5, 20, 21];
  const capacities: (number | null)[] = [null, 0, 1, 20];
  const margins = [0, 2];

  for (const open of openCounts) {
    for (const capacity of capacities) {
      for (const margin of margins) {
        it(`open=${open} capacity=${capacity} margin=${margin}`, () => {
          expect(isOverloaded(open, capacity, margin)).toBe(
            legacyIsOverloaded(open, capacity ?? "", margin),
          );
        });
      }
    }
  }

  it("treats capacity 0 as a real limit and null as unset", () => {
    expect(isOverloaded(1, 0)).toBe(true);
    expect(isOverloaded(0, 0)).toBe(false);
    expect(isOverloaded(1000, null)).toBe(false);
  });
});
