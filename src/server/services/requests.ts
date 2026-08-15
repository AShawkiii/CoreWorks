import { EntityType, RequestStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { REQUEST_OPEN_STATUSES } from "@/lib/domain/enums";
import { REQUEST_STATUS_LABELS } from "@/lib/domain/labels";
import type {
  CreateRequestInput,
  UpdateRequestInput,
} from "@/lib/validation/request";
import { ForbiddenError, type OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { nextDisplayId } from "@/server/services/ids";
import { notifyRequestAssigned } from "@/server/services/notifications";

/**
 * Client request service.
 *
 * Port of legacy `requests/ClientRequestService.gs` (audit §6.8).
 *
 * **Requests have no state machine either.** Legacy's `updateRequestStatus`
 * accepts any status and validates none; the `onEdit` handler routed only
 * `TASKS.Status`. Preserved as-is.
 *
 * The one behaviour that IS load-bearing is the Received Date stamp: it is
 * what freezes Days Waiting (audit §6.4), so it happens on the status change
 * and nowhere else.
 *
 * Days Waiting and its bucket are never stored. Legacy read them from a live
 * ARRAYFORMULA column; CoreWorks derives them on read, so there is no column
 * to go stale.
 */

export class RequestOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestOperationError";
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

async function requireClientInOrg(
  ctx: OrgContext,
  clientId: string,
  db: Db = prisma,
): Promise<{ id: string; name: string }> {
  const client = await db.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!client) {
    throw new ForbiddenError("Client not found in this organization.");
  }
  return client;
}

async function requireMemberInOrg(
  ctx: OrgContext,
  memberId: string | null,
  db: Db = prisma,
): Promise<string | null> {
  if (!memberId) return null;

  const member = await db.organizationMember.findFirst({
    where: { id: memberId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!member) {
    throw new ForbiddenError("Member not found in this organization.");
  }
  return member.id;
}

async function requireRequestInOrg(ctx: OrgContext, requestId: string) {
  const request = await prisma.clientRequest.findFirst({
    where: {
      id: requestId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    select: {
      id: true,
      clientId: true,
      title: true,
      status: true,
      requestedDate: true,
      receivedDate: true,
      assignedToId: true,
    },
  });
  if (!request) {
    throw new ForbiddenError("Request not found in this organization.");
  }
  return request;
}

/**
 * Legacy `createClientRequest`.
 *
 * Two required fields, two defaults: `Status` to Requested and `Requested
 * Date` to today.
 */
export async function createRequest(
  ctx: OrgContext,
  input: CreateRequestInput,
  today: Date = new Date(),
): Promise<{ id: string; displayId: string }> {
  if (!input.clientId || !input.title) {
    throw new RequestOperationError("Client and Request are required.");
  }

  const client = await requireClientInOrg(ctx, input.clientId);
  const assignedToId = await requireMemberInOrg(ctx, input.assignedToId);

  const request = await prisma.$transaction(async (tx) => {
    const displayId = await nextDisplayId(
      ctx.organizationId,
      "CLIENT_REQUEST",
      tx,
    );

    return tx.clientRequest.create({
      data: {
        organizationId: ctx.organizationId,
        displayId,
        clientId: client.id,
        title: input.title,
        description: input.description,
        status: RequestStatus.REQUESTED,
        priority: input.priority,
        assignedToId,
        requestedDate: input.requestedDate ?? today,
        requiredBy: input.requiredBy,
        notes: input.notes,
      },
      select: { id: true, displayId: true },
    });
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.REQUEST_CREATED,
    entityType: EntityType.CLIENT_REQUEST,
    entityId: request.id,
    clientId: client.id,
    newValue: input.title,
  });

  // Phase 11. Only when someone was actually named on it.
  if (assignedToId) {
    await notifyRequestAssigned(ctx, request.id);
  }

  return request;
}

/**
 * Updates a request's editable fields.
 *
 * Status is deliberately absent — it moves only through
 * `changeRequestStatus`, so the Received Date stamp cannot be skipped.
 */
export async function updateRequest(
  ctx: OrgContext,
  input: UpdateRequestInput,
): Promise<void> {
  const existing = await requireRequestInOrg(ctx, input.requestId);

  const client = await requireClientInOrg(ctx, input.clientId);
  const assignedToId = await requireMemberInOrg(ctx, input.assignedToId);

  await prisma.clientRequest.update({
    where: { id: input.requestId },
    data: {
      clientId: client.id,
      title: input.title,
      description: input.description,
      priority: input.priority,
      assignedToId,
      // Requested Date anchors Days Waiting and is not nullable in legacy —
      // clearing the field leaves the original date rather than blanking it.
      requestedDate: input.requestedDate ?? undefined,
      requiredBy: input.requiredBy,
      notes: input.notes,
    },
  });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.REQUEST_UPDATED,
    entityType: EntityType.CLIENT_REQUEST,
    entityId: input.requestId,
    clientId: client.id,
    previousValue: existing.title,
    newValue: input.title,
  });

  // Phase 11. Same rule as tasks and issues.
  if (existing.assignedToId !== assignedToId && assignedToId) {
    await notifyRequestAssigned(ctx, input.requestId);
  }
}

/**
 * Legacy `updateRequestStatus`.
 *
 * Verbatim behaviour:
 *
 *  - Any status is accepted; there is no transition table.
 *  - Moving to **Received** stamps a Received Date, defaulting to today
 *    unless one is supplied. This is what freezes Days Waiting.
 *  - The activity entry is written only when the status actually changed.
 *
 * Reopening — moving from ANY closed status back to an open one — clears the
 * stamp, so an outstanding request never displays a receipt date. Legacy had
 * no reopen path at all, so this is net-new rather than a deviation. It has to
 * cover every closed status, not just Received: a request taken Received →
 * Not Available → Requested would otherwise carry its old stamp back into an
 * open state.
 *
 * Moving between two CLOSED statuses (Received → Not Available) does NOT clear
 * it, matching legacy, which only ever wrote the stamp and never removed one.
 */
export async function changeRequestStatus(
  ctx: OrgContext,
  requestId: string,
  newStatus: RequestStatus,
  options: { receivedDate?: Date | null; resolution?: string | null } = {},
  today: Date = new Date(),
): Promise<void> {
  const request = await requireRequestInOrg(ctx, requestId);

  if (request.status === newStatus) return;

  const data: Prisma.ClientRequestUpdateInput = { status: newStatus };

  const reopening =
    !REQUEST_OPEN_STATUSES.includes(request.status) &&
    REQUEST_OPEN_STATUSES.includes(newStatus);

  if (newStatus === RequestStatus.RECEIVED) {
    data.receivedDate = options.receivedDate ?? today;
  } else if (reopening) {
    data.receivedDate = null;
  }

  if (options.resolution !== undefined && options.resolution !== null) {
    data.resolution = options.resolution;
  }

  await prisma.clientRequest.update({ where: { id: requestId }, data });

  await logActivity(ctx, {
    action: ACTIVITY_ACTIONS.REQUEST_STATUS_CHANGED,
    entityType: EntityType.CLIENT_REQUEST,
    entityId: requestId,
    clientId: request.clientId,
    previousValue: REQUEST_STATUS_LABELS[request.status],
    newValue: REQUEST_STATUS_LABELS[newStatus],
  });
}
