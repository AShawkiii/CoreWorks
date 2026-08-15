import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HealthBadge } from "@/components/dashboard/health-badge";
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
import type { IssueSeverity } from "@/lib/domain/enums";
import {
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  PRIORITY_LABELS,
  REQUEST_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/domain/labels";
import type {
  IssueStatus,
  Priority,
  RequestStatus,
  TaskStatus,
} from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/auth/permissions";
import {
  UPCOMING_DEADLINES_LIMIT,
  getClientDashboard,
  getClientPickerOptions,
} from "@/server/services/client-dashboard";
import { getOrgContext } from "@/server/tenancy";

import { ClientPicker } from "./client-picker";

export const metadata: Metadata = {
  title: "Client Dashboard",
};

/**
 * Client Dashboard (audit §8.4).
 *
 * Port of legacy's dropdown-driven CLIENT_DASHBOARD sheet: the picker, the
 * eight info fields, the seven summary cards, service-area progress, current
 * tasks, open requests, open issues, and upcoming deadlines — in that order.
 *
 * Every figure comes from a Phase 3 domain function. Nothing is recomputed
 * here.
 */
export default async function ClientDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "report:view")) notFound();

  const clients = await getClientPickerOptions(ctx);
  const raw = await searchParams;

  // No selection defaults to the first client, so the page is never an empty
  // frame. Legacy's sheet held the last-picked name in its cell instead.
  const requested = typeof raw.clientId === "string" ? raw.clientId : "";
  const selectedId =
    clients.find((client) => client.id === requested)?.id ??
    clients[0]?.id ??
    "";

  const dashboard = selectedId
    ? await getClientDashboard(ctx, selectedId)
    : null;

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const stampFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const fmt = (date: Date | null) =>
    date ? dateFormatter.format(date) : "—";
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  const canViewTasks = hasPermission(ctx.role, "task:view");
  const canViewIssues = hasPermission(ctx.role, "issue:view");
  const canViewRequests = hasPermission(ctx.role, "request:view");
  const canViewClients = hasPermission(ctx.role, "client:view");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Client Dashboard"
        description="One client at a time: the whole engagement in a single view."
        actions={
          dashboard && canViewClients ? (
            <Link
              href={`/clients/${dashboard.client.id}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open client record
            </Link>
          ) : null
        }
      />

      <div className="mb-6">
        <ClientPicker clients={clients} selectedId={selectedId} />
      </div>

      {!dashboard ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {clients.length === 0 ? "No clients yet" : "Select a client"}
            </CardTitle>
            <CardDescription>
              {clients.length === 0
                ? "Add a client to see their dashboard here."
                : "Choose a client above to load their dashboard."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          {/* Legacy INFO_FIELDS, in the sheet's order. */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{dashboard.client.name}</CardTitle>
              <CardDescription>
                {dashboard.client.displayId}
                {dashboard.client.companyName
                  ? ` · ${dashboard.client.companyName}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <dl className="grid gap-4 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Account manager">
                {dashboard.client.accountManagerName ?? "—"}
              </Info>
              <Info label="Service package">
                {dashboard.client.servicePackageName ?? "—"}
              </Info>
              <Info label="Client health">
                <HealthBadge health={dashboard.client.health} />
              </Info>
              <Info label="Simple completion">
                {pct(dashboard.client.simpleCompletionPct)}
              </Info>
              <Info label="Weighted completion">
                {pct(dashboard.client.weightedCompletionPct)}
              </Info>
              <Info label="Last activity">
                {fmt(dashboard.client.lastActivityAt)}
              </Info>
              <Info label="Next deadline">
                {fmt(dashboard.client.nextDeadline)}
              </Info>
            </dl>
          </Card>

          {/* Legacy SUMMARY_CARDS — the seven, in order. Cancelled excluded. */}
          <section aria-labelledby="summary-heading" className="mb-6">
            <h2 id="summary-heading" className="sr-only">
              Task summary
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <SummaryCard label="Total" value={dashboard.summary.total} />
              <SummaryCard
                label="Completed"
                value={dashboard.summary.completed}
              />
              <SummaryCard
                label="In Progress"
                value={dashboard.summary.inProgress}
              />
              <SummaryCard
                label="Not Started"
                value={dashboard.summary.notStarted}
              />
              <SummaryCard
                label="Waiting Client"
                value={dashboard.summary.waitingClient}
              />
              <SummaryCard
                label="Blocked"
                value={dashboard.summary.blocked}
                tone={dashboard.summary.blocked > 0 ? "warning" : undefined}
              />
              <SummaryCard
                label="Overdue"
                value={dashboard.summary.overdue}
                tone={dashboard.summary.overdue > 0 ? "danger" : undefined}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Cancelled tasks are excluded from all seven counts.
            </p>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle>Service area progress</CardTitle>
                <CardDescription>
                  Simple completion per area, alphabetically.
                </CardDescription>
              </CardHeader>
              {dashboard.serviceProgress.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  No tasks recorded yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service area</TableHead>
                      <TableHead className="text-right">Completion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.serviceProgress.map((row) => (
                      <TableRow key={row.serviceArea}>
                        <TableCell className="font-medium">
                          {row.serviceArea}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct(row.completionPct)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Current tasks</CardTitle>
                  <CardDescription>
                    Open work, soonest due first; tasks with no date sort last.
                  </CardDescription>
                </div>
                {canViewTasks ? (
                  <Link
                    href={{
                      pathname: "/tasks",
                      query: { clientId: dashboard.client.id, status: "OPEN" },
                    }}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    All tasks
                  </Link>
                ) : null}
              </CardHeader>
              {dashboard.currentTasks.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  No open tasks.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Assigned to</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Due date</TableHead>
                      <TableHead className="text-right">Days left</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.currentTasks.map((task) => (
                      <TableRow key={task.taskId}>
                        <TableCell className="font-medium">
                          {canViewTasks ? (
                            <Link
                              href={`/tasks/${task.taskId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {task.taskName}
                            </Link>
                          ) : (
                            task.taskName
                          )}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            {task.serviceArea}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {task.assignedTo ?? "Unassigned"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {TASK_STATUS_LABELS[task.status as TaskStatus]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {PRIORITY_LABELS[task.priority as Priority]}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {fmt(task.dueDate)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            task.daysRemaining !== null && task.daysRemaining < 0
                              ? "font-medium text-danger"
                              : "text-muted-foreground",
                          )}
                        >
                          {task.daysRemaining ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Outstanding requests</CardTitle>
                  <CardDescription>Longest waiting first.</CardDescription>
                </div>
                {canViewRequests ? (
                  <Link
                    href={{
                      pathname: "/requests",
                      query: { clientId: dashboard.client.id, status: "OPEN" },
                    }}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    All
                  </Link>
                ) : null}
              </CardHeader>
              {dashboard.requests.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  Nothing outstanding.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Waiting</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.requests.map((request) => (
                      <TableRow key={request.requestId}>
                        <TableCell className="font-medium">
                          {canViewRequests ? (
                            <Link
                              href={`/requests/${request.requestId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {request.title}
                            </Link>
                          ) : (
                            request.title
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {
                              REQUEST_STATUS_LABELS[
                                request.status as RequestStatus
                              ]
                            }
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {request.daysWaiting === null ? (
                            "—"
                          ) : (
                            <span
                              className={cn(
                                request.daysWaitingBucket === "15+" &&
                                  "font-medium text-danger",
                              )}
                            >
                              {request.daysWaiting}d
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>Open issues</CardTitle>
                  <CardDescription>Most severe first.</CardDescription>
                </div>
                {canViewIssues ? (
                  <Link
                    href={{
                      pathname: "/issues",
                      query: { clientId: dashboard.client.id, status: "OPEN" },
                    }}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    All
                  </Link>
                ) : null}
              </CardHeader>
              {dashboard.issues.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  No open issues.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Issue</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.issues.map((issue) => (
                      <TableRow key={issue.issueId}>
                        <TableCell className="font-medium">
                          {canViewIssues ? (
                            <Link
                              href={`/issues/${issue.issueId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {issue.title}
                            </Link>
                          ) : (
                            issue.title
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              issue.severity === "CRITICAL"
                                ? "danger"
                                : issue.severity === "HIGH"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {
                              ISSUE_SEVERITY_LABELS[
                                issue.severity as IssueSeverity
                              ]
                            }
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ISSUE_STATUS_LABELS[issue.status as IssueStatus]}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming deadlines</CardTitle>
                <CardDescription>
                  Next {UPCOMING_DEADLINES_LIMIT} open tasks with a due date.
                </CardDescription>
              </CardHeader>
              {dashboard.upcomingDeadlines.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  Nothing scheduled.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Days left</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.upcomingDeadlines.map((deadline) => (
                      <TableRow key={deadline.taskId}>
                        <TableCell className="font-medium">
                          {canViewTasks ? (
                            <Link
                              href={`/tasks/${deadline.taskId}`}
                              className="underline-offset-4 hover:underline"
                            >
                              {deadline.taskName}
                            </Link>
                          ) : (
                            deadline.taskName
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {fmt(deadline.dueDate)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            deadline.daysRemaining !== null &&
                              deadline.daysRemaining < 0
                              ? "font-medium text-danger"
                              : "text-muted-foreground",
                          )}
                        >
                          {deadline.daysRemaining ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Figures as at {stampFormatter.format(dashboard.generatedAt)}. Every
            number is derived live from the current data.
          </p>
        </>
      )}
    </div>
  );
}

function Info({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
    </div>
  );
}
