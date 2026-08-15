import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
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
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/auth/permissions";
import { getTeamDashboard } from "@/server/services/dashboard";
import { getOrgSettings } from "@/server/services/settings";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Team Dashboard",
};

/**
 * Team Dashboard (audit §8.5).
 *
 * Port of legacy `dashboards/TeamDashboardEngine.gs` — one row per member,
 * with the same eleven columns in the same order.
 *
 * Every figure comes from the Phase 3 port. Nothing is recomputed here.
 */
export default async function TeamDashboardPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "report:view")) notFound();

  const [rows, settings] = await Promise.all([
    getTeamDashboard(ctx),
    getOrgSettings(ctx.organizationId),
  ]);

  const canViewTasks = hasPermission(ctx.role, "task:view");
  const canViewMembers = hasPermission(ctx.role, "member:view");
  const margin = settings.WORKLOAD_OVERLOAD_MARGIN;

  const overloadedCount = rows.filter((row) => row.overloaded).length;
  const unrated = rows.filter((row) => row.capacity === null).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Team Dashboard"
        description="One row per team member: what they carry, what is late, and whether they are over capacity."
        actions={
          canViewMembers ? (
            <Link
              href="/settings/members"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Manage members
            </Link>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Workload</CardTitle>
          <CardDescription>
            Cancelled tasks are excluded from every count. Critical counts open
            tasks only — a completed critical task is not a live risk.
          </CardDescription>
        </CardHeader>

        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            No team members yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">In progress</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead className="text-right">Critical</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.memberId}>
                  <TableCell className="font-medium">
                    {canViewTasks ? (
                      <Link
                        href={{
                          pathname: "/tasks",
                          query: { assignedToId: row.memberId, status: "OPEN" },
                        }}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.memberName}
                      </Link>
                    ) : (
                      row.memberName
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.jobTitle ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.assigned}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.completed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.inProgress}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.overdue > 0 ? (
                      <span className="font-medium text-danger">
                        {row.overdue}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.waitingClient}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.critical > 0 ? (
                      <span className="font-medium text-warning">
                        {row.critical}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.round(row.completionPct * 100)}%
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      row.capacity === null
                        ? "text-muted-foreground"
                        : undefined,
                    )}
                  >
                    {row.capacity ?? "—"}
                  </TableCell>
                  <TableCell>
                    {row.capacity === null ? (
                      <span className="text-xs text-muted-foreground">
                        Not rated
                      </span>
                    ) : (
                      <Badge variant={row.overloaded ? "danger" : "success"}>
                        {row.overloaded ? "Overloaded" : "OK"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="mt-4 flex flex-col gap-1 text-xs text-muted-foreground">
        <p>
          {overloadedCount === 0
            ? "Nobody is over capacity."
            : `${overloadedCount} ${overloadedCount === 1 ? "member is" : "members are"} over capacity.`}{" "}
          A member counts as overloaded when their open tasks exceed capacity
          {margin > 0 ? ` plus the ${margin}-task margin` : ""}.
        </p>
        {unrated > 0 ? (
          <p>
            {unrated} {unrated === 1 ? "member has" : "members have"} no
            capacity set and can never be flagged — a capacity of 0 is a real
            value meaning any open task is too many, which is not the same as
            leaving it blank.
          </p>
        ) : null}
      </div>
    </div>
  );
}
