import {
  EntityType,
  NotificationType,
  TaskStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { computeDaysRemaining } from "@/lib/domain/date";
import { CLIENT_HEALTH_LABELS } from "@/lib/domain/labels";
import type { ClientHealth } from "@/lib/domain/enums";
import {
  deadlineReminderFor,
  describeReminder,
  isConfigurableNotificationType,
  parseMentions,
  type MentionCandidate,
} from "@/lib/domain/notification";
import type {
  NotificationListQuery,
  UpdateNotificationPreferencesInput,
} from "@/lib/validation/notification";
import { ForbiddenError, type OrgContext } from "@/server/context";
import { getOrgSettings } from "@/server/services/settings";

/**
 * Notifications.
 *
 * NET-NEW (audit §15). There is no legacy counterpart, so this file ports
 * nothing — every rule is a CoreWorks decision, stated where it is made.
 *
 * Four rules hold across every emitter:
 *
 *  1. **A notification is addressed to a USER, not a member.** `Notification`
 *     has a `userId`; tasks, issues, and requests are assigned to an
 *     `OrganizationMember`. Every emitter resolves member → user, and skips a
 *     member with no active membership rather than guessing.
 *
 *  2. **Never notify yourself.** Assigning yourself a task tells you nothing
 *     you did not just do. The scheduled pass is exempt: it has no user, so
 *     there is nobody to suppress.
 *
 *  3. **Preferences are checked here, once**, so an emitter cannot forget.
 *     An absent preference row means enabled.
 *
 *  4. **Delivery never fails the mutation that caused it.** Reassigning a task
 *     must not 500 because a notification row could not be written; the write
 *     is the user's intent and the notification is a courtesy. Failures are
 *     logged to the server console and swallowed — see `deliver`.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const NOTIFICATIONS_PAGE_SIZE = 30;

export interface NotificationDraft {
  /** OrganizationMember id. Resolved to a user id before writing. */
  memberId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: EntityType | null;
  entityId?: string | null;
}

// ---------------------------------------------------------------------------
// Core delivery
// ---------------------------------------------------------------------------

/**
 * Users who have opted OUT of a type, among the given candidates.
 *
 * Queried as a set of explicit opt-outs rather than a lookup per user, so one
 * bulk reassignment costs one query however many people it touches.
 */
async function optedOut(
  organizationId: string,
  userIds: string[],
  type: NotificationType,
  db: Db,
): Promise<Set<string>> {
  if (userIds.length === 0 || !isConfigurableNotificationType(type)) {
    return new Set();
  }

  const rows = await db.notificationPreference.findMany({
    where: {
      organizationId,
      userId: { in: userIds },
      type,
      enabled: false,
    },
    select: { userId: true },
  });

  return new Set(rows.map((row) => row.userId));
}

/**
 * Writes notifications for the given drafts.
 *
 * Returns the number actually created, which is what the tests assert against
 * — a caller that "sent" three notifications to one muted and two deleted
 * users sent zero, and should say so.
 */
export async function createNotifications(
  ctx: OrgContext,
  drafts: readonly NotificationDraft[],
  db: Db = prisma,
): Promise<number> {
  if (drafts.length === 0) return 0;

  const memberIds = [...new Set(drafts.map((draft) => draft.memberId))];

  // Only ACTIVE members in THIS organization. A deactivated member is not
  // working the queue, and a member id from another tenant must resolve to
  // nothing rather than to that tenant's user.
  const members = await db.organizationMember.findMany({
    where: {
      id: { in: memberIds },
      organizationId: ctx.organizationId,
      isActive: true,
      deletedAt: null,
      user: { deletedAt: null },
    },
    select: { id: true, userId: true },
  });

  const userIdByMember = new Map(members.map((m) => [m.id, m.userId]));
  if (userIdByMember.size === 0) return 0;

  const candidateUserIds = [...new Set(members.map((m) => m.userId))];

  const optOutByType = new Map<NotificationType, Set<string>>();
  for (const type of new Set(drafts.map((draft) => draft.type))) {
    optOutByType.set(
      type,
      await optedOut(ctx.organizationId, candidateUserIds, type, db),
    );
  }

  const rows: Prisma.NotificationCreateManyInput[] = [];

  for (const draft of drafts) {
    const userId = userIdByMember.get(draft.memberId);
    if (!userId) continue;

    // Rule 2. `ctx.userId` is null for a scheduled run, and null never equals
    // a real user id, so the nightly pass notifies everyone it should.
    if (userId === ctx.userId) continue;

    if (optOutByType.get(draft.type)?.has(userId)) continue;

    rows.push({
      organizationId: ctx.organizationId,
      userId,
      type: draft.type,
      title: draft.title,
      body: draft.body ?? null,
      href: draft.href ?? null,
      entityType: draft.entityType ?? null,
      entityId: draft.entityId ?? null,
    });
  }

  if (rows.length === 0) return 0;

  await db.notification.createMany({ data: rows });
  return rows.length;
}

/**
 * Rule 4 — delivery never fails its caller.
 *
 * Every emitter below goes through this. The `catch` is deliberate and is the
 * only place in the codebase that swallows an error: a notification is a
 * courtesy attached to a write that has already happened, and rethrowing here
 * would roll back or 500 the user's actual intent.
 */
async function deliver(
  ctx: OrgContext,
  build: () => Promise<readonly NotificationDraft[]>,
): Promise<number> {
  try {
    return await createNotifications(ctx, await build());
  } catch (error) {
    console.error("[notifications] delivery failed", error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

/** Someone was given a task. Called on create, on edit, and per bulk reassign. */
export async function notifyTaskAssigned(
  ctx: OrgContext,
  taskId: string,
): Promise<number> {
  return deliver(ctx, async () => {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        displayId: true,
        taskName: true,
        assignedToId: true,
        dueDate: true,
        client: { select: { name: true } },
      },
    });
    if (!task?.assignedToId) return [];

    return [
      {
        memberId: task.assignedToId,
        type: NotificationType.TASK_ASSIGNED,
        title: `${task.displayId} — ${task.taskName}`,
        body: `${task.client.name}${
          task.dueDate ? ` · due ${task.dueDate.toISOString().slice(0, 10)}` : ""
        }`,
        href: `/tasks/${task.id}`,
        entityType: EntityType.TASK,
        entityId: task.id,
      },
    ];
  });
}

/** Bulk reassignment — one notification per task, to the one new assignee. */
export async function notifyTasksAssigned(
  ctx: OrgContext,
  taskIds: readonly string[],
): Promise<number> {
  if (taskIds.length === 0) return 0;

  return deliver(ctx, async () => {
    const tasks = await prisma.task.findMany({
      where: {
        id: { in: [...taskIds] },
        organizationId: ctx.organizationId,
        deletedAt: null,
        assignedToId: { not: null },
      },
      select: {
        id: true,
        displayId: true,
        taskName: true,
        assignedToId: true,
        client: { select: { name: true } },
      },
    });

    return tasks.flatMap((task) =>
      task.assignedToId
        ? [
            {
              memberId: task.assignedToId,
              type: NotificationType.TASK_ASSIGNED,
              title: `${task.displayId} — ${task.taskName}`,
              body: task.client.name,
              href: `/tasks/${task.id}`,
              entityType: EntityType.TASK,
              entityId: task.id,
            },
          ]
        : [],
    );
  });
}

export async function notifyIssueAssigned(
  ctx: OrgContext,
  issueId: string,
): Promise<number> {
  return deliver(ctx, async () => {
    const issue = await prisma.issue.findFirst({
      where: {
        id: issueId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        displayId: true,
        title: true,
        severity: true,
        assignedToId: true,
        client: { select: { name: true } },
      },
    });
    if (!issue?.assignedToId) return [];

    return [
      {
        memberId: issue.assignedToId,
        type: NotificationType.ISSUE_ASSIGNED,
        title: `${issue.displayId} — ${issue.title}`,
        body: `${issue.client.name} · ${issue.severity} severity`,
        href: `/issues/${issue.id}`,
        entityType: EntityType.ISSUE,
        entityId: issue.id,
      },
    ];
  });
}

export async function notifyRequestAssigned(
  ctx: OrgContext,
  requestId: string,
): Promise<number> {
  return deliver(ctx, async () => {
    const request = await prisma.clientRequest.findFirst({
      where: {
        id: requestId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        displayId: true,
        title: true,
        assignedToId: true,
        requiredBy: true,
        client: { select: { name: true } },
      },
    });
    if (!request?.assignedToId) return [];

    return [
      {
        memberId: request.assignedToId,
        type: NotificationType.REQUEST_ASSIGNED,
        title: `${request.displayId} — ${request.title}`,
        body: `${request.client.name}${
          request.requiredBy
            ? ` · required by ${request.requiredBy.toISOString().slice(0, 10)}`
            : ""
        }`,
        href: `/requests/${request.id}`,
        entityType: EntityType.CLIENT_REQUEST,
        entityId: request.id,
      },
    ];
  });
}

/**
 * A client changed health.
 *
 * Addressed to the account manager and the backup member — the two people the
 * schema says own the relationship. It is deliberately NOT sent to everyone
 * with `client:view`: on a book of two hundred clients that is a nightly flood
 * nobody reads, which is how a notification system becomes noise.
 *
 * Called from the health engine only when the value actually changed, so a
 * nightly recalculation that confirms On Track sends nothing.
 */
export async function notifyClientHealthChanged(
  ctx: OrgContext,
  clientId: string,
  previous: ClientHealth,
  next: ClientHealth,
): Promise<number> {
  return deliver(ctx, async () => {
    const client = await prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        displayId: true,
        accountManagerId: true,
        backupMemberId: true,
      },
    });
    if (!client) return [];

    const owners = [client.accountManagerId, client.backupMemberId].filter(
      (id): id is string => Boolean(id),
    );
    // A client can have the same person as manager and backup.
    const unique = [...new Set(owners)];

    return unique.map((memberId) => ({
      memberId,
      type: NotificationType.CLIENT_HEALTH_CHANGED,
      title: `${client.name} is now ${CLIENT_HEALTH_LABELS[next]}`,
      body: `Was ${CLIENT_HEALTH_LABELS[previous]}.`,
      href: `/clients/${client.id}`,
      entityType: EntityType.CLIENT,
      entityId: client.id,
    }));
  });
}

/**
 * Mentions in a comment body.
 *
 * The candidate list is every active member of the organization; matching
 * itself is the pure `parseMentions`, so the rule is unit-testable without a
 * database. Mentioning yourself sends nothing — `createNotifications` drops it.
 */
export async function notifyMentions(
  ctx: OrgContext,
  body: string,
  target: { href: string; entityType: EntityType; entityId: string; label: string },
): Promise<number> {
  return deliver(ctx, async () => {
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        deletedAt: null,
        user: { deletedAt: null },
      },
      select: { id: true, user: { select: { name: true } } },
    });

    const candidates: MentionCandidate[] = members.map((member) => ({
      id: member.id,
      name: member.user.name,
    }));

    const mentioned = parseMentions(body, candidates);
    if (mentioned.length === 0) return [];

    const excerpt = body.length > 160 ? `${body.slice(0, 157)}…` : body;

    return mentioned.map((memberId) => ({
      memberId,
      type: NotificationType.MENTION,
      title: `${ctx.userName} mentioned you on ${target.label}`,
      body: excerpt,
      href: target.href,
      entityType: target.entityType,
      entityId: target.entityId,
    }));
  });
}

/**
 * Operational notice to the people who run the organization.
 *
 * Addressed by ROLE rather than to a named person, because the audience is
 * "whoever is responsible", which changes as staff do. `SYSTEM` is the one
 * type a user cannot mute.
 */
export async function notifySystem(
  ctx: OrgContext,
  input: { title: string; body?: string | null; href?: string | null },
  roles: readonly ("OWNER" | "ADMIN" | "MANAGER")[] = ["OWNER", "ADMIN"],
): Promise<number> {
  return deliver(ctx, async () => {
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        role: { in: [...roles] },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    return members.map((member) => ({
      memberId: member.id,
      type: NotificationType.SYSTEM,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: EntityType.SYSTEM,
      entityId: null,
    }));
  });
}

/**
 * Deadline reminders for every open, assigned task — the nightly pass.
 *
 * This is the notification counterpart of the daily recalculation, and exists
 * for the same reason (audit §9): **a deadline passes because the date rolled
 * over, not because anyone edited anything.** No mutation hook will ever fire
 * for it.
 *
 * Re-running the same day must not double-send, so a task already notified
 * with the same type today is skipped. That check is what makes the job safe
 * to re-run — the same property the generation job has.
 */
export async function notifyDueAndOverdueTasks(
  ctx: OrgContext,
  today: Date = new Date(),
): Promise<{ dueSoon: number; overdue: number }> {
  const settings = await getOrgSettings(ctx.organizationId);
  const dueSoonDays = settings.HEALTH_AT_RISK_DUE_SOON_DAYS;

  const tasks = await prisma.task.findMany({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      assignedToId: { not: null },
      dueDate: { not: null },
      status: {
        notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
      },
    },
    select: {
      id: true,
      displayId: true,
      taskName: true,
      status: true,
      dueDate: true,
      assignedToId: true,
      client: { select: { name: true } },
    },
  });

  const drafts: NotificationDraft[] = [];

  for (const task of tasks) {
    if (!task.assignedToId) continue;

    const daysRemaining = computeDaysRemaining(
      task.dueDate,
      task.status,
      today,
    );
    const reminder = deadlineReminderFor(daysRemaining, dueSoonDays);
    if (!reminder) continue;

    const type =
      reminder.kind === "overdue"
        ? NotificationType.TASK_OVERDUE
        : NotificationType.TASK_DUE_SOON;

    drafts.push({
      memberId: task.assignedToId,
      type,
      title: `${describeReminder(reminder)} — ${task.taskName}`,
      body: `${task.displayId} · ${task.client.name}`,
      href: `/tasks/${task.id}`,
      entityType: EntityType.TASK,
      entityId: task.id,
    });
  }

  const fresh = await withoutTodaysDuplicates(ctx, drafts, today);

  // Delivered per type, and the counts are what `createNotifications` actually
  // wrote. Deriving them from `fresh` instead would over-report: that array is
  // what was eligible, before muted, inactive, and self-assigned recipients
  // are dropped.
  return {
    dueSoon: await createNotifications(
      ctx,
      fresh.filter((draft) => draft.type === NotificationType.TASK_DUE_SOON),
    ),
    overdue: await createNotifications(
      ctx,
      fresh.filter((draft) => draft.type === NotificationType.TASK_OVERDUE),
    ),
  };
}

/**
 * Drops drafts that already have a notification of the same type, for the same
 * entity, sent today.
 *
 * Compared on the calendar day rather than a 24-hour window: the job runs on a
 * clock, and "already told them this morning" is the question being asked.
 */
async function withoutTodaysDuplicates(
  ctx: OrgContext,
  drafts: readonly NotificationDraft[],
  today: Date,
): Promise<NotificationDraft[]> {
  if (drafts.length === 0) return [];

  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const existing = await prisma.notification.findMany({
    where: {
      organizationId: ctx.organizationId,
      type: {
        in: [NotificationType.TASK_DUE_SOON, NotificationType.TASK_OVERDUE],
      },
      entityId: { in: drafts.map((draft) => draft.entityId ?? "") },
      createdAt: { gte: startOfDay },
    },
    select: { type: true, entityId: true, userId: true },
  });

  if (existing.length === 0) return [...drafts];

  // Keyed on entity + type only. The assignee cannot have changed mid-pass,
  // and keying on the user as well would re-send the moment a task moved.
  const seen = new Set(
    existing.map((row) => `${row.entityId ?? ""}|${row.type}`),
  );

  return drafts.filter(
    (draft) => !seen.has(`${draft.entityId ?? ""}|${draft.type}`),
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: Date;
}

export interface NotificationListResult {
  rows: NotificationRow[];
  total: number;
  unread: number;
  page: number;
  pageCount: number;
}

/**
 * The signed-in user's notifications.
 *
 * Scoped by `userId` AND `organizationId`. The user scope is the access
 * boundary — notifications are personal, and no role grants sight of another
 * person's — while the organization scope stops a multi-tenant user seeing one
 * tenant's notices while working in the other.
 */
export async function listNotifications(
  ctx: OrgContext,
  query: NotificationListQuery,
): Promise<NotificationListResult> {
  if (!ctx.userId) {
    return { rows: [], total: 0, unread: 0, page: 1, pageCount: 1 };
  }

  const where: Prisma.NotificationWhereInput = {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
  };

  if (query.unread) where.readAt = null;
  if (query.type && query.type !== "ALL") where.type = query.type;

  const [total, unread] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        readAt: null,
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  const rows = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
    take: NOTIFICATIONS_PAGE_SIZE,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      href: true,
      readAt: true,
      createdAt: true,
    },
  });

  return {
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      href: row.href,
      read: row.readAt !== null,
      createdAt: row.createdAt,
    })),
    total,
    unread,
    page,
    pageCount,
  };
}

/** Unread count for the header indicator. */
export async function countUnreadNotifications(
  ctx: OrgContext,
): Promise<number> {
  if (!ctx.userId) return 0;
  return prisma.notification.count({
    where: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      readAt: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Marks one notification read or unread.
 *
 * The `where` carries the user id, so a notification belonging to someone else
 * is not found rather than updated. Checking ownership after loading it would
 * work too; scoping the query means the unsafe version cannot be written by
 * accident.
 */
export async function setNotificationRead(
  ctx: OrgContext,
  notificationId: string,
  read: boolean,
): Promise<void> {
  if (!ctx.userId) throw new ForbiddenError("Sign in to manage notifications.");

  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
    },
    data: { readAt: read ? new Date() : null },
  });

  if (result.count === 0) {
    throw new ForbiddenError("Notification not found.");
  }
}

/** Marks every unread notification read. Returns how many changed. */
export async function markAllNotificationsRead(
  ctx: OrgContext,
): Promise<number> {
  if (!ctx.userId) throw new ForbiddenError("Sign in to manage notifications.");

  const result = await prisma.notification.updateMany({
    where: {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  return result.count;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * The user's preferences as a complete map.
 *
 * Every configurable type appears, defaulting to enabled, so the settings form
 * renders the full list whether or not any row exists. `SYSTEM` is excluded —
 * it is not configurable, and offering a checkbox that cannot be unticked
 * would be a control that lies.
 */
export async function getNotificationPreferences(
  ctx: OrgContext,
): Promise<Record<NotificationType, boolean>> {
  const defaults = Object.fromEntries(
    Object.values(NotificationType).map((type) => [type, true]),
  ) as Record<NotificationType, boolean>;

  if (!ctx.userId) return defaults;

  const rows = await prisma.notificationPreference.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.userId },
    select: { type: true, enabled: true },
  });

  for (const row of rows) {
    if (!isConfigurableNotificationType(row.type)) continue;
    defaults[row.type] = row.enabled;
  }

  return defaults;
}

/**
 * Replaces the user's preferences with the submitted set.
 *
 * The form posts the ENABLED types; everything configurable and absent is an
 * opt-out. Written as an upsert per type rather than delete-then-insert so a
 * failure part-way cannot leave the user with no preferences at all, silently
 * re-enabling what they just muted.
 */
export async function updateNotificationPreferences(
  ctx: OrgContext,
  input: UpdateNotificationPreferencesInput,
): Promise<void> {
  if (!ctx.userId) throw new ForbiddenError("Sign in to manage notifications.");
  const userId = ctx.userId;

  // Widened to the full enum: the schema narrows the submitted values to the
  // configurable subset, but this set is probed with every type below.
  const enabled = new Set<NotificationType>(input.enabled);

  await prisma.$transaction(
    Object.values(NotificationType)
      .filter(isConfigurableNotificationType)
      .map((type) =>
        prisma.notificationPreference.upsert({
          where: {
            organizationId_userId_type: {
              organizationId: ctx.organizationId,
              userId,
              type,
            },
          },
          create: {
            organizationId: ctx.organizationId,
            userId,
            type,
            enabled: enabled.has(type),
          },
          update: { enabled: enabled.has(type) },
        }),
      ),
  );
}
