import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/domain/csv";
import { MONTHLY_CLOSE_STAGES } from "@/lib/domain/enums";
import {
  CLIENT_HEALTH_LABELS,
  CLOSE_STAGE_STATUS_LABELS,
  CLOSE_STATUS_LABELS,
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
} from "@/lib/domain/legacy-values";
import { LEGACY_HEADERS, type LegacySheet } from "@/lib/domain/legacy-schema";
import {
  bucketDaysWaiting,
  computeDaysOverdue,
  computeDaysRemaining,
  computeDaysWaiting,
} from "@/lib/domain/date";
import type { OrgContext } from "@/server/context";

/**
 * CSV export (migration-plan §6).
 *
 * > *"Every importable entity is also exportable to CSV, using the **same
 * > legacy headers**. This gives round-tripping, the post-cutover rollback
 * > path, and continuity for staff who still want a spreadsheet — without
 * > CoreWorks depending on one."*
 *
 * Two consequences of that sentence drive this file:
 *
 *  - **All eleven entities, not the convenient ones.** §5 names export as the
 *    rollback path after cutover — *"rollback means exporting CoreWorks to CSV
 *    and re-importing to Sheets, which is why CSV export covers every entity"*.
 *    An entity without an exporter is an entity you cannot roll back.
 *  - **Derived columns ARE exported**, though they are never imported (§3.2).
 *    The export reproduces the legacy sheet, and a sheet missing its computed
 *    columns is not that sheet. They are recomputed here from live data rather
 *    than read from a stored copy, so the file is correct as of the export
 *    rather than as of the last recalculation pass.
 *
 * Values are written with the same label tables the importer reads, so a round
 * trip is exact by construction rather than by coincidence.
 */

/** Today, for the columns legacy computed live in the sheet. */
type Row = string[];

export interface ExportResult {
  sheet: LegacySheet;
  filename: string;
  csv: string;
  rowCount: number;
}

function result(
  sheet: LegacySheet,
  rows: Row[],
  organizationSlug: string,
): ExportResult {
  const headers = LEGACY_HEADERS[sheet] as readonly string[];
  return {
    sheet,
    filename: `${organizationSlug}-${sheet.toLowerCase()}.csv`,
    csv: toCsv(headers, rows),
    rowCount: rows.length,
  };
}

const text = (value: string | null | undefined): string => value ?? "";
const num = (value: number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value);

/**
 * Exports one sheet.
 *
 * Every query is scoped by `ctx.organizationId`, which is what stops an export
 * becoming the widest possible tenant leak: a single CSV of another
 * organization's entire book of business.
 */
export async function exportSheet(
  ctx: OrgContext,
  sheet: LegacySheet,
  today: Date = new Date(),
): Promise<ExportResult> {
  const where = { organizationId: ctx.organizationId, deletedAt: null };

  switch (sheet) {
    case "EMPLOYEES": {
      const members = await prisma.organizationMember.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          jobTitle: true,
          department: true,
          capacity: true,
          isActive: true,
          notes: true,
          user: { select: { name: true, email: true } },
          manager: { select: { user: { select: { name: true } } } },
        },
      });

      return result(
        sheet,
        members.map((m) => [
          m.displayId,
          m.user.name,
          text(m.jobTitle),
          text(m.department),
          m.user.email,
          formatYesNo(m.isActive),
          text(m.manager?.user.name),
          num(m.capacity),
          text(m.notes),
        ]),
        ctx.organizationSlug,
      );
    }

    case "SERVICES": {
      const services = await prisma.service.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          name: true,
          category: true,
          description: true,
          isActive: true,
        },
      });

      return result(
        sheet,
        services.map((s) => [
          s.displayId,
          s.name,
          text(s.category),
          text(s.description),
          formatYesNo(s.isActive),
        ]),
        ctx.organizationSlug,
      );
    }

    case "SERVICE_PACKAGES": {
      const packages = await prisma.servicePackage.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          name: true,
          description: true,
          isActive: true,
          services: { select: { service: { select: { name: true } } } },
        },
      });

      return result(
        sheet,
        packages.map((p) => [
          p.displayId,
          p.name,
          text(p.description),
          // Re-flattened to the legacy free-text cell, so the file a legacy
          // sheet would accept is the file this produces (audit §14.3).
          p.services.map((link) => link.service.name).join(", "),
          formatYesNo(p.isActive),
        ]),
        ctx.organizationSlug,
      );
    }

    case "TASK_TEMPLATES": {
      const templates = await prisma.taskTemplate.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          serviceArea: true,
          taskName: true,
          description: true,
          frequency: true,
          priority: true,
          defaultAssigneeRole: true,
          typicalDurationDays: true,
          requiresClientInput: true,
          isActive: true,
          servicePackage: { select: { name: true } },
        },
      });

      return result(
        sheet,
        templates.map((t) => [
          t.displayId,
          t.servicePackage.name,
          t.serviceArea,
          t.taskName,
          text(t.description),
          FREQUENCY_LABELS[t.frequency],
          PRIORITY_LABELS[t.priority],
          text(t.defaultAssigneeRole),
          num(t.typicalDurationDays),
          formatYesNo(t.requiresClientInput),
          formatYesNo(t.isActive),
        ]),
        ctx.organizationSlug,
      );
    }

    case "CLIENTS": {
      const clients = await prisma.client.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          name: true,
          companyName: true,
          industry: true,
          businessType: true,
          startDate: true,
          contactName: true,
          email: true,
          phone: true,
          accountingSystem: true,
          reportingFrequency: true,
          monthEndClosingDay: true,
          contractStatus: true,
          priority: true,
          health: true,
          simpleCompletionPct: true,
          weightedCompletionPct: true,
          lastActivityAt: true,
          nextDeadline: true,
          notes: true,
          servicePackage: { select: { name: true } },
          accountManager: { select: { user: { select: { name: true } } } },
          backupMember: { select: { user: { select: { name: true } } } },
        },
      });

      return result(
        sheet,
        clients.map((c) => [
          c.displayId,
          c.name,
          text(c.companyName),
          text(c.industry),
          text(c.businessType),
          formatLegacyDate(c.startDate),
          text(c.servicePackage?.name),
          text(c.accountManager?.user.name),
          text(c.backupMember?.user.name),
          text(c.contactName),
          text(c.email),
          text(c.phone),
          text(c.accountingSystem),
          c.reportingFrequency
            ? REPORTING_FREQUENCY_LABELS[c.reportingFrequency]
            : "",
          num(c.monthEndClosingDay),
          CONTRACT_STATUS_LABELS[c.contractStatus],
          PRIORITY_LABELS[c.priority],
          // Derived — exported, never imported (§3.2).
          CLIENT_HEALTH_LABELS[c.health],
          formatLegacyPercent(c.simpleCompletionPct),
          formatLegacyPercent(c.weightedCompletionPct),
          formatLegacyDate(c.lastActivityAt),
          formatLegacyDate(c.nextDeadline),
          text(c.notes),
        ]),
        ctx.organizationSlug,
      );
    }

    case "TASKS": {
      const tasks = await prisma.task.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          serviceArea: true,
          taskCategory: true,
          taskName: true,
          description: true,
          period: true,
          frequency: true,
          priority: true,
          status: true,
          startDate: true,
          dueDate: true,
          completionDate: true,
          waitingFor: true,
          clientDependency: true,
          completionPct: true,
          reviewStatus: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          client: { select: { displayId: true, name: true } },
          assignedTo: { select: { user: { select: { name: true } } } },
          reviewer: { select: { user: { select: { name: true } } } },
        },
      });

      return result(
        sheet,
        tasks.map((t) => [
          t.displayId,
          t.client.displayId,
          t.client.name,
          t.serviceArea,
          TASK_CATEGORY_LABELS[t.taskCategory],
          t.taskName,
          text(t.description),
          text(t.period),
          t.frequency ? FREQUENCY_LABELS[t.frequency] : "",
          text(t.assignedTo?.user.name),
          PRIORITY_LABELS[t.priority],
          TASK_STATUS_LABELS[t.status],
          formatLegacyDate(t.startDate),
          formatLegacyDate(t.dueDate),
          formatLegacyDate(t.completionDate),
          // Derived, and recomputed here rather than read from a column —
          // legacy held these in a live ARRAYFORMULA, so the export is correct
          // as of now rather than as of the last nightly pass.
          num(computeDaysRemaining(t.dueDate, t.status, today)),
          num(computeDaysOverdue(t.dueDate, t.status, today)),
          text(t.waitingFor),
          formatYesNo(t.clientDependency),
          formatLegacyPercent(t.completionPct),
          text(t.reviewer?.user.name),
          REVIEW_STATUS_LABELS[t.reviewStatus],
          text(t.notes),
          formatLegacyDate(t.createdAt),
          formatLegacyDate(t.updatedAt),
        ]),
        ctx.organizationSlug,
      );
    }

    case "CLIENT_REQUESTS": {
      const requests = await prisma.clientRequest.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          title: true,
          requestedDate: true,
          requiredBy: true,
          receivedDate: true,
          status: true,
          priority: true,
          notes: true,
          client: { select: { displayId: true, name: true } },
          assignedTo: { select: { user: { select: { name: true } } } },
        },
      });

      return result(
        sheet,
        requests.map((r) => {
          // Legacy's own signature: the status decides whether the clock is
          // still running or frozen at the received date (audit §6.4).
          const waiting = computeDaysWaiting(
            r.requestedDate,
            r.status,
            today,
            r.receivedDate,
          );
          return [
            r.displayId,
            r.client.displayId,
            r.client.name,
            r.title,
            formatLegacyDate(r.requestedDate),
            formatLegacyDate(r.requiredBy),
            REQUEST_STATUS_LABELS[r.status],
            // Derived — legacy read both from a live formula (§3.2).
            num(waiting),
            bucketDaysWaiting(waiting) ?? "",
            PRIORITY_LABELS[r.priority],
            text(r.assignedTo?.user.name),
            formatLegacyDate(r.receivedDate),
            text(r.notes),
          ];
        }),
        ctx.organizationSlug,
      );
    }

    case "ISSUES": {
      const issues = await prisma.issue.findMany({
        where,
        orderBy: { displayId: "asc" },
        select: {
          displayId: true,
          title: true,
          category: true,
          dateRaised: true,
          severity: true,
          status: true,
          impact: true,
          requiredAction: true,
          deadline: true,
          resolutionDate: true,
          notes: true,
          client: { select: { displayId: true, name: true } },
          assignedTo: { select: { user: { select: { name: true } } } },
        },
      });

      return result(
        sheet,
        issues.map((i) => [
          i.displayId,
          i.client.displayId,
          i.client.name,
          i.title,
          text(i.category),
          formatLegacyDate(i.dateRaised),
          ISSUE_SEVERITY_LABELS[i.severity],
          text(i.assignedTo?.user.name),
          ISSUE_STATUS_LABELS[i.status],
          text(i.impact),
          text(i.requiredAction),
          formatLegacyDate(i.deadline),
          formatLegacyDate(i.resolutionDate),
          text(i.notes),
        ]),
        ctx.organizationSlug,
      );
    }

    case "MONTHLY_CLOSE": {
      const closes = await prisma.monthlyClose.findMany({
        where,
        orderBy: [{ period: "asc" }, { displayId: "asc" }],
        select: {
          displayId: true,
          period: true,
          status: true,
          completionPct: true,
          client: { select: { name: true } },
          stages: { select: { stageName: true, status: true } },
        },
      });

      return result(
        sheet,
        closes.map((close) => {
          // The inverse of the §3.6 transform: 18 rows become 18 columns
          // again, in the legacy column order.
          const byStage = new Map(
            close.stages.map((stage) => [stage.stageName, stage.status]),
          );

          return [
            close.displayId,
            close.client.name,
            close.period,
            ...MONTHLY_CLOSE_STAGES.map((stageName) => {
              const status = byStage.get(stageName);
              return status ? CLOSE_STAGE_STATUS_LABELS[status] : "";
            }),
            CLOSE_STATUS_LABELS[close.status],
            formatLegacyPercent(close.completionPct),
          ];
        }),
        ctx.organizationSlug,
      );
    }

    case "ACTIVITY_LOG": {
      const entries = await prisma.activityLog.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: "asc" },
        select: {
          displayId: true,
          createdAt: true,
          userEmail: true,
          entityType: true,
          entityId: true,
          action: true,
          previousValue: true,
          newValue: true,
          comment: true,
          user: { select: { name: true } },
          client: { select: { name: true } },
        },
      });

      return result(
        sheet,
        entries.map((e) => [
          e.displayId,
          formatLegacyDate(e.createdAt),
          // Name when the user still exists, otherwise the email snapshot
          // that outlives them (audit D4).
          text(e.user?.name ?? e.userEmail),
          text(e.client?.name),
          ENTITY_TYPE_LABELS[e.entityType],
          text(e.entityId),
          e.action,
          text(e.previousValue),
          text(e.newValue),
          text(e.comment),
        ]),
        ctx.organizationSlug,
      );
    }

    case "SETTINGS": {
      const settings = await prisma.organizationSetting.findMany({
        where: { organizationId: ctx.organizationId },
        orderBy: [{ category: "asc" }, { key: "asc" }],
        select: {
          category: true,
          key: true,
          value: true,
          description: true,
        },
      });

      return result(
        sheet,
        settings.map((s) => [s.category, s.key, s.value, text(s.description)]),
        ctx.organizationSlug,
      );
    }
  }
}

/** Row counts per sheet, for the export screen. */
export async function getExportCounts(
  ctx: OrgContext,
): Promise<Record<LegacySheet, number>> {
  const where = { organizationId: ctx.organizationId, deletedAt: null };
  const orgOnly = { organizationId: ctx.organizationId };

  const [
    employees,
    services,
    packages,
    templates,
    clients,
    tasks,
    requests,
    issues,
    closes,
    activity,
    settings,
  ] = await Promise.all([
    prisma.organizationMember.count({ where }),
    prisma.service.count({ where }),
    prisma.servicePackage.count({ where }),
    prisma.taskTemplate.count({ where }),
    prisma.client.count({ where }),
    prisma.task.count({ where }),
    prisma.clientRequest.count({ where }),
    prisma.issue.count({ where }),
    prisma.monthlyClose.count({ where }),
    prisma.activityLog.count({ where: orgOnly }),
    prisma.organizationSetting.count({ where: orgOnly }),
  ]);

  return {
    EMPLOYEES: employees,
    SERVICES: services,
    SERVICE_PACKAGES: packages,
    TASK_TEMPLATES: templates,
    CLIENTS: clients,
    TASKS: tasks,
    CLIENT_REQUESTS: requests,
    ISSUES: issues,
    MONTHLY_CLOSE: closes,
    ACTIVITY_LOG: activity,
    SETTINGS: settings,
  };
}
