import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { OrgContext } from "@/server/context";

/**
 * Audit-trail reads.
 *
 * Closes the last gap `security.md` named:
 *
 * > *"A reader for `AuditLog`, distinct from the Activity Log screen delivered
 * > in Phase 11."*
 *
 * The distinction is the point, and it is why this is a separate screen rather
 * than a filter on the existing one:
 *
 * | | `ActivityLog` | `AuditLog` |
 * |---|---|---|
 * | Answers | *what happened to this client* | *who touched this system* |
 * | Written by | the ported business rules (audit §6.14) | authentication and data movement |
 * | Read by | Owner, Admin, Manager (`activity:view`) | Owner and Admin (`settings:manage`) |
 * | Scope | always one organization | may have none — a failed sign-in belongs to no tenant |
 *
 * That last row is the one that makes them genuinely different tables. A
 * sign-in attempt against an unknown email cannot be attributed to an
 * organization, so `AuditLog.organizationId` is nullable while
 * `ActivityLog.organizationId` is not. Folding the two together would have
 * meant either losing those rows or making the business trail nullable.
 */

export const AUDIT_PAGE_SIZE = 50;

export interface AuditRow {
  id: string;
  createdAt: Date;
  action: string;
  userEmail: string | null;
  userName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  entityType: string | null;
  entityId: string | null;
  /** True when the entry belongs to no organization — a failed sign-in. */
  unattributed: boolean;
}

export interface AuditListQuery {
  action?: string;
  q?: string;
  page: number;
}

export interface AuditListResult {
  rows: AuditRow[];
  total: number;
  page: number;
  pageCount: number;
  actions: string[];
  /** Failed sign-ins in the last 24 hours, across all subjects. */
  recentFailures: number;
}

/**
 * Entries visible to one organization's administrators.
 *
 * Scoped to `organizationId` **or null**. The null half is deliberate and is
 * the reason this reader exists: a sign-in attempt against an address that
 * belongs to nobody has no tenant, and those are exactly the rows an
 * administrator investigating a brute-force attempt needs to see.
 *
 * The exposure that creates is bounded and worth stating: an administrator of
 * organization A can see that *someone* failed to sign in as
 * `alex@example.com`, even if Alex belongs only to organization B. That is an
 * email address and a timestamp — no tenant data, no session, nothing about
 * B's business. Hiding it instead would leave every deployment unable to see
 * an attack in progress, which is the worse trade.
 */
export async function listAuditLog(
  ctx: OrgContext,
  query: AuditListQuery,
): Promise<AuditListResult> {
  const where: Prisma.AuditLogWhereInput = {
    OR: [{ organizationId: ctx.organizationId }, { organizationId: null }],
  };

  if (query.action && query.action !== "ALL") where.action = query.action;

  if (query.q) {
    where.AND = [
      {
        OR: [
          { userEmail: { contains: query.q, mode: "insensitive" } },
          { action: { contains: query.q, mode: "insensitive" } },
          { ipAddress: { contains: query.q, mode: "insensitive" } },
        ],
      },
    ];
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, rows, actions, recentFailures] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (Math.max(1, query.page) - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        action: true,
        userEmail: true,
        ipAddress: true,
        userAgent: true,
        entityType: true,
        entityId: true,
        organizationId: true,
        user: { select: { name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where,
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    }),
    prisma.auditLog.count({
      where: {
        ...where,
        createdAt: { gte: dayAgo },
        action: { startsWith: "sign_in." },
        NOT: { action: "sign_in.success" },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  return {
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      userEmail: row.userEmail,
      userName: row.user?.name ?? null,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      entityType: row.entityType,
      entityId: row.entityId,
      unattributed: row.organizationId === null,
    })),
    total,
    page: Math.min(Math.max(1, query.page), pageCount),
    pageCount,
    actions: actions.map((row) => row.action),
    recentFailures,
  };
}
