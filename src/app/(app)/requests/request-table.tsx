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
import { Priority, RequestStatus } from "@/generated/prisma/enums";
import type { DaysWaitingBucket } from "@/lib/domain/enums";
import { PRIORITY_LABELS, REQUEST_STATUS_LABELS } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import type { RequestListRow } from "@/server/services/request-queries";

/**
 * The client request list.
 *
 * A Server Component — no client state to hold.
 *
 * Days Waiting is shown with its legacy bucket. The buckets are what the
 * spreadsheet colour-coded (`ENUMS.DAYS_WAITING_BUCKET`), so the escalation
 * a user learned there reads the same here.
 */

const STATUS_VARIANT: Record<
  RequestStatus,
  "neutral" | "primary" | "warning" | "success"
> = {
  REQUESTED: "primary",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  NOT_AVAILABLE: "neutral",
  CANCELLED: "neutral",
};

const BUCKET_CLASS: Record<DaysWaitingBucket, string> = {
  "0-3": "text-muted-foreground",
  "4-7": "text-muted-foreground",
  "8-14": "text-warning",
  "15+": "font-medium text-danger",
};

export function RequestTable({ rows }: { rows: RequestListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-sm font-medium">No requests found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try widening your filters, or raise a request.
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
          <TableHead>Request</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Assigned to</TableHead>
          <TableHead>Requested</TableHead>
          <TableHead>Required by</TableHead>
          <TableHead className="text-right">Waiting</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link
                href={`/requests/${row.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {row.title}
              </Link>
              {row.stale ? (
                <Badge variant="danger" className="ml-2">
                  Stale
                </Badge>
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
              <Badge variant={STATUS_VARIANT[row.status]}>
                {REQUEST_STATUS_LABELS[row.status]}
              </Badge>
            </TableCell>

            <TableCell>
              <Badge
                variant={
                  row.priority === Priority.CRITICAL
                    ? "danger"
                    : row.priority === Priority.HIGH
                      ? "warning"
                      : "neutral"
                }
              >
                {PRIORITY_LABELS[row.priority]}
              </Badge>
            </TableCell>

            <TableCell className="text-muted-foreground">
              {row.assignedToName ?? "Unassigned"}
            </TableCell>

            <TableCell className="whitespace-nowrap text-muted-foreground">
              {fmt(row.requestedDate)}
            </TableCell>

            <TableCell className="whitespace-nowrap text-muted-foreground">
              {fmt(row.requiredBy)}
            </TableCell>

            <TableCell
              className={cn(
                "whitespace-nowrap text-right tabular-nums",
                row.bucket ? BUCKET_CLASS[row.bucket] : "text-muted-foreground",
              )}
            >
              {row.daysWaiting === null ? (
                "—"
              ) : (
                <>
                  {row.daysWaiting}d
                  <span className="ml-1.5 text-xs opacity-70">
                    {row.bucket}
                  </span>
                </>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
