import type { Prisma } from "@/generated/prisma/client";
import { IssueSeverity, IssueStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { toDateOnly } from "@/lib/domain/date";
import { ISSUE_CLOSED_STATUSES } from "@/lib/domain/enums";
import {
  isIssueOpen,
  isOverdueIssue,
  isUnresolvedCriticalOrHigh,
  selectSurfacedIssues,
} from "@/lib/domain/issue";
import type { DomainIssue } from "@/lib/domain/types";
import type { IssueListQuery } from "@/lib/validation/issue";
import type { OrgContext } from "@/server/context";
import { issueSelect, toDomainIssue } from "@/server/services/mappers";

/**
 * Issue queries.
 *
 * Reads only. "Needing attention" is not re-derived here — it calls
 * `selectSurfacedIssues`, the Phase 3 port of the single function legacy used
 * for both the spreadsheet Control Center and the Web App. The audit is
 * explicit that it must not be re-implemented (§6.5), so the filter narrows
 * in SQL and then hands the result to that function for the final say.
 */

export const ISSUES_PAGE_SIZE = 50;

export interface IssueListRow {
  id: string;
  displayId: string;
  title: string;
  category: string | null;
  clientId: string;
  clientName: string;
  severity: IssueSeverity;
  status: IssueStatus;
  assignedToName: string | null;
  /** Nullable to match `DomainIssue` — legacy sheets could hold a blank. */
  dateRaised: Date | null;
  deadline: Date | null;
  /** Legacy `isOverdueIssue` — open, has a deadline, deadline passed. */
  overdue: boolean;
  /** Legacy `selectSurfacedIssues` membership. */
  surfaced: boolean;
}

export interface IssueListResult {
  rows: IssueListRow[];
  total: number;
  page: number;
  pageCount: number;
}

export async function listIssues(
  ctx: OrgContext,
  query: IssueListQuery,
  today: Date = new Date(),
): Promise<IssueListResult> {
  const where: Prisma.IssueWhereInput = {
    organizationId: ctx.organizationId,
    deletedAt: null,
  };

  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { displayId: { contains: query.q, mode: "insensitive" } },
      { category: { contains: query.q, mode: "insensitive" } },
      { client: { name: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  if (query.clientId && query.clientId !== "ALL") {
    where.clientId = query.clientId;
  }

  if (query.status && query.status !== "ALL") {
    where.status =
      query.status === "OPEN"
        ? { notIn: [...ISSUE_CLOSED_STATUSES] }
        : query.status;
  }

  if (query.severity && query.severity !== "ALL") {
    where.severity = query.severity;
  }

  if (query.assignedToId && query.assignedToId !== "ALL") {
    where.assignedToId =
      query.assignedToId === "UNASSIGNED" ? null : query.assignedToId;
  }

  if (query.surfaced) {
    // Mirrors selectSurfacedIssues: unresolved AND (Critical/High OR past
    // deadline). Narrowed in SQL so paging stays correct; membership is still
    // confirmed per row by the domain function below.
    where.status = { notIn: [...ISSUE_CLOSED_STATUSES] };
    where.OR = [
      { severity: { in: [IssueSeverity.CRITICAL, IssueSeverity.HIGH] } },
      { deadline: { lt: toDateOnly(today) } },
    ];

    // A search term and the surfaced filter both want `OR`; combine them with
    // AND so neither silently replaces the other.
    if (query.q) {
      where.AND = [
        {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { displayId: { contains: query.q, mode: "insensitive" } },
            { category: { contains: query.q, mode: "insensitive" } },
            { client: { name: { contains: query.q, mode: "insensitive" } } },
          ],
        },
      ];
    }
  }

  const total = await prisma.issue.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ISSUES_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  // Severity sorts by the legacy weight order (Critical > High > Medium >
  // Low), which is the enum's declaration order, so `desc` is correct. The
  // oldest-first tiebreak is legacy's, and it matters: among equally severe
  // issues the one ignored longest rises.
  const orderBy: Prisma.IssueOrderByWithRelationInput[] =
    query.sort === "raised"
      ? [{ dateRaised: "desc" }]
      : query.sort === "deadline"
        ? [{ deadline: { sort: "asc", nulls: "last" } }, { severity: "desc" }]
        : query.sort === "client"
          ? [{ client: { name: "asc" } }, { severity: "desc" }]
          : query.sort === "status"
            ? [{ status: "asc" }, { severity: "desc" }]
            : [{ severity: "desc" }, { dateRaised: "asc" }];

  const rows = await prisma.issue.findMany({
    where,
    select: issueSelect,
    orderBy,
    skip: (page - 1) * ISSUES_PAGE_SIZE,
    take: ISSUES_PAGE_SIZE,
  });

  const domain = rows.map(toDomainIssue);

  // The authority on surfacing, run over this page's rows.
  const surfacedIds = new Set(
    selectSurfacedIssues(domain, today).map((issue) => issue.id),
  );

  return {
    rows: domain.map((issue) => toListRow(issue, today, surfacedIds)),
    total,
    page,
    pageCount,
  };
}

function toListRow(
  issue: DomainIssue,
  today: Date,
  surfacedIds: ReadonlySet<string>,
): IssueListRow {
  return {
    id: issue.id,
    displayId: issue.displayId,
    title: issue.title,
    category: issue.category,
    clientId: issue.clientId,
    clientName: issue.clientName,
    severity: issue.severity,
    status: issue.status,
    assignedToName: issue.assignedToName,
    dateRaised: issue.dateRaised,
    deadline: issue.deadline,
    overdue: isOverdueIssue(issue, today),
    surfaced: surfacedIds.has(issue.id),
  };
}

export interface IssueComment {
  id: string;
  body: string;
  authorName: string | null;
  authorId: string | null;
  createdAt: Date;
}

export interface IssueDetail {
  issue: DomainIssue;
  impact: string | null;
  description: string | null;
  resolution: string | null;
  resolutionDate: Date | null;
  notes: string | null;
  clientDisplayId: string;
  assignedToId: string | null;
  open: boolean;
  overdue: boolean;
  criticalOrHigh: boolean;
  comments: IssueComment[];
}

export async function getIssueDetail(
  ctx: OrgContext,
  issueId: string,
  today: Date = new Date(),
): Promise<IssueDetail | null> {
  const row = await prisma.issue.findFirst({
    where: { id: issueId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      ...issueSelect,
      impact: true,
      description: true,
      resolution: true,
      resolutionDate: true,
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

  const issue = toDomainIssue(row);

  return {
    issue,
    impact: row.impact,
    description: row.description,
    resolution: row.resolution,
    resolutionDate: row.resolutionDate,
    notes: row.notes,
    clientDisplayId: row.client.displayId,
    assignedToId: row.assignedToId,
    open: isIssueOpen(issue.status),
    overdue: isOverdueIssue(issue, today),
    criticalOrHigh: isUnresolvedCriticalOrHigh(issue),
    comments: row.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      authorId: comment.authorId,
      authorName: comment.author?.name ?? null,
      createdAt: comment.createdAt,
    })),
  };
}

/** Select options for the issue forms and filters, always org-scoped. */
export async function getIssueFormOptions(ctx: OrgContext) {
  const [clients, members, categories] = await Promise.all([
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
    prisma.issue.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        category: { not: null },
      },
      distinct: ["category"],
      orderBy: { category: "asc" },
      select: { category: true },
    }),
  ]);

  return {
    clients,
    members: members.map((m) => ({ id: m.id, name: m.user.name })),
    categories: categories
      .map((row) => row.category)
      .filter((category): category is string => Boolean(category)),
  };
}
