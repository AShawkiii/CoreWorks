import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CloseStatus } from "@/generated/prisma/enums";
import { formatPeriod } from "@/lib/domain/date";
import {
  CLOSE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
} from "@/lib/domain/labels";
import { closeListQuerySchema } from "@/lib/validation/monthly-close";
import { hasPermission } from "@/server/auth/permissions";
import {
  CLOSES_PAGE_SIZE,
  getCloseFormOptions,
  listMonthlyCloses,
} from "@/server/services/monthly-close";
import { getOrgContext } from "@/server/tenancy";

import { CloseFilters } from "./close-filters";
import { OpenCloseForm } from "./open-close-form";

export const metadata: Metadata = {
  title: "Monthly Close",
};

const STATUS_VARIANT: Record<
  CloseStatus,
  "neutral" | "primary" | "danger" | "success"
> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "primary",
  BLOCKED: "danger",
  CLOSED: "success",
};

export default async function MonthlyClosePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "close:view")) notFound();

  const raw = await searchParams;
  const parsed = closeListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : closeListQuerySchema.parse({});

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    listMonthlyCloses(ctx, query),
    getCloseFormOptions(ctx),
  ]);

  const canManage = hasPermission(ctx.role, "close:manage");

  const buildPageHref = (target: number) => {
    const q: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) q[key] = value;
    }
    q.page = String(target);
    return { pathname: "/monthly-close" as const, query: q };
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Monthly Close"
        description={`${total} close${total === 1 ? "" : "s"} matching your filters. Each runs the same eighteen-stage checklist.`}
      />

      {canManage ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Open a close</CardTitle>
            <CardDescription>
              One close per client per period.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OpenCloseForm
              clients={options.clients}
              defaultPeriod={formatPeriod(new Date())}
            />
          </CardContent>
        </Card>
      ) : null}

      <CloseFilters clients={options.clients} periods={options.periods} />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">No closes found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canManage
                ? "Open one above to start a period."
                : "Try widening your filters."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Close</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Stages</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead>Review</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/monthly-close/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.displayId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/clients/${row.clientId}`}
                      className="text-muted-foreground underline-offset-4 hover:underline"
                    >
                      {row.clientName}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">{row.period}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {CLOSE_STATUS_LABELS[row.status]}
                    </Badge>
                    {row.stagesBlocked > 0 &&
                    row.status !== CloseStatus.BLOCKED ? (
                      <span className="ml-2 text-xs text-danger">
                        {row.stagesBlocked} blocked
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.stagesCompleted}/{row.stageCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.round(row.completionPct * 100)}%
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {REVIEW_STATUS_LABELS[row.reviewStatus]}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <p className="text-muted-foreground">
            Page {page} of {pageCount} · {CLOSES_PAGE_SIZE} per page
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
