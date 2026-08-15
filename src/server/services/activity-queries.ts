import type { EntityType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { SYSTEM_ACTOR_EMAIL, type OrgContext } from "@/server/context";
import type { ActivityListQuery } from "@/lib/validation/notification";

/**
 * Activity log reads.
 *
 * The write side is `services/activity.ts`, the port of legacy
 * `automation/ActivityLogger.gs` (audit §6.14). Legacy had no reader: the
 * ACTIVITY_LOG sheet was scrolled and filtered by hand. This is the screen
 * that replaces that, so the queries here are net-new while every row they
 * return was written by the ported rules.
 *
 * There is no write path in this module and there must never be one. An audit
 * trail that a user can edit through the screen that displays it is not an
 * audit trail.
 */

export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityRow {
  id: string;
  displayId: string;
  createdAt: Date;
  /** Null for a scheduled run — see `userLabel`. */
  userName: string | null;
  userEmail: string | null;
  clientId: string | null;
  clientName: string | null;
  entityType: EntityType;
  entityId: string | null;
  action: string;
  previousValue: string | null;
  newValue: string | null;
  comment: string | null;
  /** True when the entry was written by a scheduled job rather than a person. */
  system: boolean;
}

export interface ActivityListResult {
  rows: ActivityRow[];
  total: number;
  page: number;
  pageCount: number;
}

function buildWhere(
  ctx: OrgContext,
  query: ActivityListQuery,
): Prisma.ActivityLogWhereInput {
  const where: Prisma.ActivityLogWhereInput = {
    organizationId: ctx.organizationId,
  };

  if (query.clientId && query.clientId !== "ALL") {
    where.clientId = query.clientId;
  }

  if (query.entityType && query.entityType !== "ALL") {
    where.entityType = query.entityType;
  }

  if (query.action && query.action !== "ALL") {
    where.action = query.action;
  }

  if (query.userId && query.userId !== "ALL") {
    // A scheduled run writes a null userId with the system email snapshot
    // beside it (Phase 10). Filtering on `userId: null` alone would also
    // return entries whose author was later deleted, which is a different
    // thing — hence the email test.
    where.userId =
      query.userId === "SYSTEM" ? null : query.userId;
    if (query.userId === "SYSTEM") where.userEmail = SYSTEM_ACTOR_EMAIL;
  }

  if (query.from || query.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = query.from;
    if (query.to) {
      // `to` is a date, and an entry written at 14:20 on that date must be
      // included. Comparing against the date itself would silently exclude
      // everything but midnight.
      const end = new Date(query.to);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }
    where.createdAt = createdAt;
  }

  if (query.q) {
    where.OR = [
      { action: { contains: query.q, mode: "insensitive" } },
      { previousValue: { contains: query.q, mode: "insensitive" } },
      { newValue: { contains: query.q, mode: "insensitive" } },
      { comment: { contains: query.q, mode: "insensitive" } },
      { displayId: { contains: query.q, mode: "insensitive" } },
      { userEmail: { contains: query.q, mode: "insensitive" } },
      { client: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  return where;
}

export async function listActivity(
  ctx: OrgContext,
  query: ActivityListQuery,
): Promise<ActivityListResult> {
  const where = buildWhere(ctx, query);

  const total = await prisma.activityLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  const rows = await prisma.activityLog.findMany({
    where,
    // Newest first, with the display id as the tie-break. Two entries written
    // in the same millisecond — a status change and its health recalculation —
    // would otherwise order arbitrarily and could repeat across pages.
    orderBy: [{ createdAt: "desc" }, { displayId: "desc" }],
    skip: (page - 1) * ACTIVITY_PAGE_SIZE,
    take: ACTIVITY_PAGE_SIZE,
    select: {
      id: true,
      displayId: true,
      createdAt: true,
      userEmail: true,
      entityType: true,
      entityId: true,
      action: true,
      previousValue: true,
      newValue: true,
      comment: true,
      clientId: true,
      user: { select: { name: true } },
      client: { select: { name: true } },
    },
  });

  return {
    rows: rows.map((row) => ({
      id: row.id,
      displayId: row.displayId,
      createdAt: row.createdAt,
      userName: row.user?.name ?? null,
      userEmail: row.userEmail,
      clientId: row.clientId,
      clientName: row.client?.name ?? null,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      previousValue: row.previousValue,
      newValue: row.newValue,
      comment: row.comment,
      system: row.userEmail === SYSTEM_ACTOR_EMAIL,
    })),
    total,
    page,
    pageCount,
  };
}

/**
 * Options for the filter bar.
 *
 * Actions are read from the DATA rather than from `ACTIVITY_ACTIONS`. Legacy
 * wrote action names as free text, and imported history can hold values this
 * codebase no longer emits; listing only today's constants would hide those
 * rows behind a filter that cannot select them.
 */
export async function getActivityFilterOptions(ctx: OrgContext): Promise<{
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
  actions: string[];
  hasSystemEntries: boolean;
}> {
  const [clients, members, actions, systemCount] = await Promise.all([
    prisma.client.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.organizationMember.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { userId: true, user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.activityLog.findMany({
      where: { organizationId: ctx.organizationId },
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    }),
    prisma.activityLog.count({
      where: {
        organizationId: ctx.organizationId,
        userId: null,
        userEmail: SYSTEM_ACTOR_EMAIL,
      },
    }),
  ]);

  return {
    clients,
    users: members.map((member) => ({
      id: member.userId,
      name: member.user.name,
    })),
    actions: actions.map((row) => row.action),
    hasSystemEntries: systemCount > 0,
  };
}

/**
 * The most recent entries for one entity — the timeline shown on a detail
 * page.
 *
 * Scoped by organization as well as entity id, so a uuid guessed or copied
 * from another tenant returns nothing rather than that tenant's history.
 */
export async function getEntityActivity(
  ctx: OrgContext,
  entityType: EntityType,
  entityId: string,
  limit = 20,
): Promise<ActivityRow[]> {
  const rows = await prisma.activityLog.findMany({
    where: { organizationId: ctx.organizationId, entityType, entityId },
    orderBy: [{ createdAt: "desc" }, { displayId: "desc" }],
    take: limit,
    select: {
      id: true,
      displayId: true,
      createdAt: true,
      userEmail: true,
      entityType: true,
      entityId: true,
      action: true,
      previousValue: true,
      newValue: true,
      comment: true,
      clientId: true,
      user: { select: { name: true } },
      client: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    displayId: row.displayId,
    createdAt: row.createdAt,
    userName: row.user?.name ?? null,
    userEmail: row.userEmail,
    clientId: row.clientId,
    clientName: row.client?.name ?? null,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    previousValue: row.previousValue,
    newValue: row.newValue,
    comment: row.comment,
    system: row.userEmail === SYSTEM_ACTOR_EMAIL,
  }));
}

/**
 * How an entry's actor should read.
 *
 * Three cases, and conflating them would misattribute history: a scheduled run
 * (no person), a person still on the team, and a person since removed — whose
 * email snapshot is all that survives (audit D4's reason for storing it).
 */
export function activityActorLabel(row: ActivityRow): string {
  if (row.system) return "Scheduled job";
  return row.userName ?? row.userEmail ?? "Unknown";
}
