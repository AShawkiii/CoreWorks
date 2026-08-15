/**
 * Client request rules.
 *
 * Port of legacy `apps-script/requests/ClientRequestLogic.gs` (audit §6.8).
 *
 * Legacy read `Days Waiting` from a live spreadsheet column. CoreWorks
 * derives it server-side (master prompt §15), so these functions take the
 * computed value rather than a stored one — same rule, one fewer place for
 * the number to go stale.
 */

import { computeDaysWaiting } from "@/lib/domain/date";
import { REQUEST_OPEN_STATUSES, type RequestStatus } from "@/lib/domain/enums";
import type { DomainRequest } from "@/lib/domain/types";

export function isRequestOpen(status: RequestStatus): boolean {
  return REQUEST_OPEN_STATUSES.includes(status);
}

type AgeableRequest = Pick<
  DomainRequest,
  "status" | "requestedDate" | "receivedDate"
>;

/** Days waiting for one request, using the shared date rule. */
export function requestDaysWaiting(
  request: AgeableRequest,
  today: Date,
): number | null {
  return computeDaysWaiting(
    request.requestedDate,
    request.status,
    today,
    request.receivedDate,
  );
}

/**
 * Legacy `flagStaleRequests` — ids of OPEN requests waiting at or beyond the
 * threshold (default 15 days).
 *
 * Only open requests can be stale; a received request stopped waiting.
 */
export function flagStaleRequests<
  T extends AgeableRequest & { id: string },
>(requests: readonly T[], staleDaysThreshold: number, today: Date): string[] {
  return requests
    .filter((request) => {
      if (!isRequestOpen(request.status)) return false;
      const days = requestDaysWaiting(request, today);
      return days !== null && days >= staleDaysThreshold;
    })
    .map((request) => request.id);
}

export interface ClientRequestCount {
  clientName: string;
  count: number;
}

/**
 * Legacy `topClientsByOutstandingRequests` — clients with the most open
 * requests, descending, capped at `limit` (legacy default 5).
 */
export function topClientsByOutstandingRequests(
  requests: readonly Pick<DomainRequest, "status" | "clientName">[],
  limit = 5,
): ClientRequestCount[] {
  const counts = new Map<string, number>();

  for (const request of requests) {
    if (!isRequestOpen(request.status)) continue;
    counts.set(request.clientName, (counts.get(request.clientName) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([clientName, count]) => ({ clientName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
