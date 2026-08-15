import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IssueSeverity, IssueStatus } from "@/generated/prisma/enums";
import {
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
} from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import type { IssueListRow } from "@/server/services/issue-queries";

/**
 * The issue list.
 *
 * A Server Component — unlike the task table there is no bulk selection to
 * hold client state for, so nothing here needs to ship to the browser.
 */

const SEVERITY_VARIANT: Record<
  IssueSeverity,
  "neutral" | "warning" | "danger"
> = {
  LOW: "neutral",
  MEDIUM: "neutral",
  HIGH: "warning",
  CRITICAL: "danger",
};

const STATUS_VARIANT: Record<
  IssueStatus,
  "neutral" | "primary" | "danger" | "success"
> = {
  OPEN: "danger",
  IN_PROGRESS: "primary",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

export function IssueTable({ rows }: { rows: IssueListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm font-medium">No issues found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try widening your filters, or raise an issue.
        </p>
      </div>
    );
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const fmt = (date: Date | null) => (date ? formatter.format(date) : "—");

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Issue</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Assigned to</TableHead>
          <TableHead>Raised</TableHead>
          <TableHead>Deadline</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link
                href={`/issues/${row.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {row.title}
              </Link>
              {row.surfaced ? (
                <Badge variant="danger" className="ml-2">
                  Needs attention
                </Badge>
              ) : null}
              {row.category ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {row.category}
                </span>
              ) : null}
            </TableCell>

            <TableCell>
              <Link
                href={`/clients/${row.clientId}`}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                {row.clientName}
              </Link>
            </TableCell>

            <TableCell>
              <Badge variant={SEVERITY_VARIANT[row.severity]}>
                {ISSUE_SEVERITY_LABELS[row.severity]}
              </Badge>
            </TableCell>

            <TableCell>
              <Badge variant={STATUS_VARIANT[row.status]}>
                {ISSUE_STATUS_LABELS[row.status]}
              </Badge>
            </TableCell>

            <TableCell className="text-muted-foreground">
              {row.assignedToName ?? "Unassigned"}
            </TableCell>

            <TableCell className="whitespace-nowrap text-muted-foreground">
              {fmt(row.dateRaised)}
            </TableCell>

            <TableCell
              className={cn(
                "whitespace-nowrap",
                row.overdue ? "font-medium text-danger" : "text-muted-foreground",
              )}
            >
              {fmt(row.deadline)}
              {row.overdue ? " · overdue" : ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
