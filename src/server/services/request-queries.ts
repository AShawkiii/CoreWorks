import type { Prisma } from "@/generated/prisma/client";
import { Priority, RequestStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { bucketDaysWaiting, toDateOnly } from "@/lib/domain/date";
import {
  DEFAULT_SETTINGS,
  REQUEST_CLOSED_STATUSES,
  type DaysWaitingBucket,
} from "@/lib/domain/enums";
import { isRequestOpen, requestDaysWaiting } from "@/lib/domain/request";
import type { DomainRequest } from "@/lib/domain/types";
import type { RequestListQuery } from "@/lib/validation/request";
import type { OrgContext } from "@/server/context";
import { requestSelect, toDomainRequest } from "@/server/services/mappers";
import { getOrgSettings } from "@/server/services/settings";

/**
 * Client request queries.
 *
 * Days Waiting and its bucket are derived on read by the Phase 3 functions,
 * never stored (audit §7). The stale threshold comes from the organization's
 * settings, as legacy read it from the SETTINGS sheet.
 */

export const REQUESTS_PAGE_SIZE = 50;

export interface RequestListRow {
  id: string;
  displayId: string;
  title: string;
  clientId: string;
  clientName: string;
  status: RequestStatus;
  priority: Priority;
  assignedToName: string | null;
  /** Nullable to match `DomainRequest` — legacy sheets could hold a blank. */
  requestedDate: Date | null;
  requiredBy: Date | null;
  receivedDate: Date | null;
  daysWaiting: number | null;
  bucket: DaysWaitingBucket | null;
  /** Legacy `flagStaleRequests` membership. */
  stale: boolean;
}

export interface RequestListResult {
  rows: RequestListRow[];
  total: number;
  page: number;
  pageCount: number;
  /** The organization's threshold, so the UI can name it rather than hardcode 15. */
  staleDays: number;
}

/**
 * Earliest `requestedDate` that is NOT yet stale.
 *
 * `daysWaiting >= threshold` means `dateOnly(today) - dateOnly(requested) >=
 * threshold`, i.e. `dateOnly(requested) <= dateOnly(today) - threshold`. As a
 * timestamp bound that is `requested < cutoff + 1 day`, which is what this
 * returns. An integration test pins it against `requestDaysWaiting` rather
 * than trusting the arithmetic.
 */
function staleCutoff(today: Date, thresholdDays: number): Date {
  const start = toDateOnly(today);
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() - thresholdDays + 1,
  );
}

export async function listRequests(
  ctx: OrgContext,
  query: RequestListQuery,
  today: Date = new Date(),
): Promise<RequestListResult> {
  const settings = await getOrgSettings(ctx.organizationId);
  const staleDays =
    settings.REQUEST_STALE_DAYS ?? DEFAULT_SETTINGS.REQUEST_STALE_DAYS;

  const where: Prisma.ClientRequestWhereInput = {
    organizationId: ctx.organizationId,
    deletedAt: null,
  };

  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { displayId: { contains: query.q, mode: "insensitive" } },
      { client: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  if (query.clientId && query.clientId !== "ALL") {
    where.clientId = query.clientId;
  }

  if (query.status && query.status !== "ALL") {
    where.status =
      query.status === "OPEN"
        ? { notIn: [...REQUEST_CLOSED_STATUSES] }
        : query.status;
  }

  if (query.priority && query.priority !== "ALL") {
    where.priority = query.priority;
  }

  if (query.assignedToId && query.assignedToId !== "ALL") {
    where.assignedToId =
      query.assignedToId === "UNASSIGNED" ? null : query.assignedToId;
  }

  if (query.stale) {
    // Only an OPEN request can be stale — a received one stopped waiting.
    where.status = { notIn: [...REQUEST_CLOSED_STATUSES] };
    where.requestedDate = { lt: staleCutoff(today, staleDays) };
  }

  const total = await prisma.clientRequest.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / REQUESTS_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  // "waiting" sorts by requestedDate ascending — oldest first is
  // longest-waiting first, which is exactly Days Waiting descending for the
  // open requests this view is about. Days Waiting itself is not a column.
  const orderBy: Prisma.ClientRequestOrderByWithRelationInput[] =
    query.sort === "requested"
      ? [{ requestedDate: "desc" }]
      : query.sort === "requiredBy"
        ? [{ requiredBy: { sort: "asc", nulls: "last" } }]
        : query.sort === "priority"
          ? [{ priority: "desc" }, { requestedDate: "asc" }]
          : query.sort === "client"
            ? [{ client: { name: "asc" } }, { requestedDate: "asc" }]
            : query.sort === "status"
              ? [{ status: "asc" }, { requestedDate: "asc" }]
              : [{ requestedDate: "asc" }];

  const rows = await prisma.clientRequest.findMany({
    where,
    select: requestSelect,
    orderBy,
    skip: (page - 1) * REQUESTS_PAGE_SIZE,
    take: REQUESTS_PAGE_SIZE,
  });

  return {
    rows: rows
      .map(toDomainRequest)
      .map((request) => toListRow(request, today, staleDays)),
    total,
    page,
    pageCount,
    staleDays,
  };
}

function toListRow(
  request: DomainRequest,
  today: Date,
  staleDays: number,
): RequestListRow {
  const daysWaiting = requestDaysWaiting(request, today);

  return {
    id: request.id,
    displayId: request.displayId,
    title: request.title,
    clientId: request.clientId,
    clientName: request.clientName,
    status: request.status,
    priority: request.priority,
    assignedToName: request.assignedToName,
    requestedDate: request.requestedDate,
    requiredBy: request.requiredBy,
    receivedDate: request.receivedDate,
    daysWaiting,
    bucket: bucketDaysWaiting(daysWaiting),
    stale:
      isRequestOpen(request.status) &&
      daysWaiting !== null &&
      daysWaiting >= staleDays,
  };
}

export interface RequestComment {
  id: string;
  body: string;
  authorName: string | null;
  authorId: string | null;
  createdAt: Date;
}

export interface RequestDetail {
  request: DomainRequest;
  description: string | null;
  resolution: string | null;
  notes: string | null;
  clientDisplayId: string;
  assignedToId: string | null;
  open: boolean;
  daysWaiting: number | null;
  bucket: DaysWaitingBucket | null;
  stale: boolean;
  staleDays: number;
  comments: RequestComment[];
}

export async function getRequestDetail(
  ctx: OrgContext,
  requestId: string,
  today: Date = new Date(),
): Promise<RequestDetail | null> {
  const row = await prisma.clientRequest.findFirst({
    where: {
      id: requestId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: {
      ...requestSelect,
      description: true,
      resolution: true,
      notes: true,
      assignedToId: true,
      client: { select: { name: true, displayId: true } },
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          authorId: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      },
    },
  });
  if (!row) return null;

  const settings = await getOrgSettings(ctx.organizationId);
  const staleDays =
    settings.REQUEST_STALE_DAYS ?? DEFAULT_SETTINGS.REQUEST_STALE_DAYS;

  const request = toDomainRequest(row);
  const daysWaiting = requestDaysWaiting(request, today);

  return {
    request,
    description: row.description,
    resolution: row.resolution,
    notes: row.notes,
    clientDisplayId: row.client.displayId,
    assignedToId: row.assignedToId,
    open: isRequestOpen(request.status),
    daysWaiting,
    bucket: bucketDaysWaiting(daysWaiting),
    stale:
      isRequestOpen(request.status) &&
      daysWaiting !== null &&
      daysWaiting >= staleDays,
    staleDays,
    comments: row.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorId: comment.authorId,
      authorName: comment.author?.name ?? null,
      createdAt: comment.createdAt,
    })),
  };
}

/** Select options for the request forms and filters, always org-scoped. */
export async function getRequestFormOptions(ctx: OrgContext) {
  const [clients, members] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, displayId: true },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);

  return {
    clients,
    members: members.map((m) => ({ id: m.id, name: m.user.name })),
  };
}
