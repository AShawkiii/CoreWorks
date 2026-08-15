import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityType } from "@/generated/prisma/enums";
import { activityListQuerySchema } from "@/lib/validation/notification";
import { hasPermission } from "@/server/auth/permissions";
import {
  ACTIVITY_PAGE_SIZE,
  activityActorLabel,
  getActivityFilterOptions,
  listActivity,
  type ActivityRow,
} from "@/server/services/activity-queries";
import { getOrgContext } from "@/server/tenancy";

import { ActivityFilters } from "./activity-filters";

export const metadata: Metadata = {
  title: "Activity Log",
};

/**
 * Where an entry's record can be opened.
 *
 * Only the types that have a detail route are linked. The rest render as plain
 * text rather than as a link to a page that does not exist — a dead link in an
 * audit trail reads as a missing record.
 */
type EntityRoute =
  | `/tasks/${string}`
  | `/issues/${string}`
  | `/requests/${string}`
  | `/clients/${string}`
  | `/monthly-close/${string}`;

function entityHref(row: ActivityRow): EntityRoute | null {
  if (!row.entityId) return null;
  switch (row.entityType) {
    case EntityType.TASK:
      return `/tasks/${row.entityId}`;
    case EntityType.ISSUE:
      return `/issues/${row.entityId}`;
    case EntityType.CLIENT_REQUEST:
      return `/requests/${row.entityId}`;
    case EntityType.CLIENT:
      return `/clients/${row.entityId}`;
    case EntityType.MONTHLY_CLOSE:
      return `/monthly-close/${row.entityId}`;
    default:
      return null;
  }
}

function formatTimestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  // Owner, Admin, and Manager only. The activity log shows who did what across
  // every client, which is a supervisory view rather than a working one.
  if (!hasPermission(ctx.role, "activity:view")) notFound();

  const raw = await searchParams;
  const parsed = activityListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : activityListQuerySchema.parse({});

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    listActivity(ctx, query),
    getActivityFilterOptions(ctx),
  ]);

  const buildPageHref = (target: number) => {
    const q: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) q[key] = value;
    }
    q.page = String(target);
    return { pathname: "/activity" as const, query: q };
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Activity Log"
        description={`${total} entr${total === 1 ? "y" : "ies"} matching your filters. Every entry is written by the change it records and can never be edited here.`}
      />

      <ActivityFilters
        clients={options.clients}
        users={options.users}
        actions={options.actions}
        hasSystemEntries={options.hasSystemEntries}
      />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">No activity found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try widening your filters, or a longer date range.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const href = entityHref(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatTimestamp(row.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.system ? (
                          <Badge variant="neutral">Scheduled job</Badge>
                        ) : (
                          <span
                            title={row.userEmail ?? undefined}
                            className={
                              row.userName === null
                                ? "text-muted-foreground"
                                : undefined
                            }
                          >
                            {activityActorLabel(row)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{row.action}</TableCell>
                      <TableCell>
                        {row.clientId && row.clientName ? (
                          <Link
                            href={`/clients/${row.clientId}`}
                            className="text-muted-foreground underline-offset-4 hover:underline"
                          >
                            {row.clientName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {href ? (
                          <Link
                            href={href}
                            className="underline-offset-4 hover:underline"
                          >
                            {row.entityType}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {row.entityType}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md text-muted-foreground">
                        {row.previousValue && row.newValue ? (
                          <span>
                            {row.previousValue} → {row.newValue}
                          </span>
                        ) : (
                          <span>{row.newValue ?? row.previousValue ?? "—"}</span>
                        )}
                        {row.comment ? (
                          <span className="block text-xs">{row.comment}</span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Recalculation passes that change nothing are deliberately not logged, so
        this feed shows real transitions rather than every nightly run. Bulk
        operations write one summary entry rather than one per record — both
        rules are carried over from the system CoreWorks replaces.
      </p>

      {pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <p className="text-muted-foreground">
            Page {page} of {pageCount} · {ACTIVITY_PAGE_SIZE} per page
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildPageHref(page - 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Previous
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={buildPageHref(page + 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
