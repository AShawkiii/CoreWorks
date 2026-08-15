import { ArchiveRestore, ArchiveX, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HealthBadge } from "@/components/dashboard/health-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import type { IssueSeverity, TaskStatus } from "@/lib/domain/enums";
import {
  CONTRACT_STATUS_LABELS,
  ISSUE_SEVERITY_LABELS,
  PRIORITY_LABELS,
  REQUEST_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/auth/permissions";
import { toggleClientArchivedAction } from "@/server/actions/clients";
import { getClientDetail } from "@/server/services/clients";
import { getOrgContext } from "@/server/tenancy";

import { ContactsPanel } from "./contacts-panel";

export const metadata: Metadata = {
  title: "Client",
};

const TABS = [
  "overview",
  "tasks",
  "issues",
  "requests",
  "contacts",
  "services",
  "activity",
  "notes",
] as const;

type Tab = (typeof TABS)[number];

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "client:view")) notFound();

  const { id } = await params;
  const detail = await getClientDetail(ctx, id);
  if (!detail) notFound();

  const raw = await searchParams;
  const requested = typeof raw.tab === "string" ? raw.tab : "overview";
  const tab: Tab = (TABS as readonly string[]).includes(requested)
    ? (requested as Tab)
    : "overview";

  const { viewModel: vm, summary } = detail;
  const canEdit = hasPermission(ctx.role, "client:update");
  const canArchive = hasPermission(ctx.role, "client:archive");

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const fmt = (date: Date | null) => (date ? dateFormatter.format(date) : "—");

  const counts: Record<Tab, number | null> = {
    overview: null,
    tasks: vm.tasks.length,
    issues: vm.issues.length,
    requests: vm.requests.length,
    contacts: detail.contacts.length,
    services: detail.services.length,
    activity: detail.recentActivity.length,
    notes: null,
  };

  const tabHref = (target: Tab) => ({
    pathname: `/clients/${id}`,
    query: { tab: target },
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title={vm.clientName}
        description={`${vm.clientDisplayId}${vm.companyName ? ` · ${vm.companyName}` : ""}${vm.industry ? ` · ${vm.industry}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {canEdit ? (
              <Link
                href={`/clients/${id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Link>
            ) : null}
            {canArchive ? (
              <form action={toggleClientArchivedAction}>
                <input type="hidden" name="clientId" value={id} />
                <input
                  type="hidden"
                  name="archived"
                  value={detail.isArchived ? "false" : "true"}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className={detail.isArchived ? undefined : "text-danger"}
                >
                  {detail.isArchived ? (
                    <>
                      <ArchiveRestore aria-hidden="true" />
                      Restore
                    </>
                  ) : (
                    <>
                      <ArchiveX aria-hidden="true" />
                      Archive
                    </>
                  )}
                </Button>
              </form>
            ) : null}
          </div>
        }
      />

      {detail.isArchived ? (
        <div
          role="status"
          className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
        >
          This client is archived. It is excluded from the Control Center and
          from task generation. Its history is retained.
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Health">
          <HealthBadge health={vm.health} />
        </SummaryCard>
        <SummaryCard label="Status">
          <Badge variant="outline">
            {CONTRACT_STATUS_LABELS[vm.contractStatus]}
          </Badge>
        </SummaryCard>
        <SummaryCard label="Weighted completion">
          <span className="text-xl font-semibold tabular-nums">
            {Math.round(vm.weightedCompletionPct * 100)}%
          </span>
        </SummaryCard>
        <SummaryCard label="Open tasks">
          <span className="text-xl font-semibold tabular-nums">
            {vm.tasks.length}
          </span>
        </SummaryCard>
        <SummaryCard label="Overdue">
          <span
            className={cn(
              "text-xl font-semibold tabular-nums",
              summary.overdue > 0 && "text-danger",
            )}
          >
            {summary.overdue}
          </span>
        </SummaryCard>
        <SummaryCard label="Next deadline">
          <span className="text-sm font-medium">{fmt(vm.nextDeadline)}</span>
        </SummaryCard>
      </div>

      <nav aria-label="Client sections" className="mb-4">
        <ul className="flex gap-1 overflow-x-auto border-b border-border pb-px">
          {TABS.map((name) => (
            <li key={name}>
              <Link
                href={tabHref(name)}
                aria-current={tab === name ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm capitalize transition-colors",
                  tab === name
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {name}
                {counts[name] !== null ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {counts[name]}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Engagement</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Detail label="Service package" value={vm.servicePackage} />
                <Detail label="Account manager" value={vm.accountManager} />
                <Detail label="Backup member" value={vm.backupTeamMember} />
                <Detail label="Priority" value={PRIORITY_LABELS[vm.priority as keyof typeof PRIORITY_LABELS] ?? vm.priority} />
                <Detail label="Business type" value={vm.businessType} />
                <Detail
                  label="Simple completion"
                  value={`${Math.round(vm.simpleCompletionPct * 100)}%`}
                />
                <Detail label="Last activity" value={fmt(vm.lastActivity)} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Work summary</CardTitle>
              <CardDescription>
                Across all tasks, excluding cancelled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <Detail label="Total" value={String(summary.total)} />
                <Detail label="Completed" value={String(summary.completed)} />
                <Detail label="In progress" value={String(summary.inProgress)} />
                <Detail label="Not started" value={String(summary.notStarted)} />
                <Detail
                  label="Waiting client"
                  value={String(summary.waitingClient)}
                />
                <Detail label="Blocked" value={String(summary.blocked)} />
              </dl>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Progress by service area</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.serviceAreas.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No tasks recorded yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {detail.serviceAreas.map((area) => (
                    <li key={area.serviceArea} className="flex items-center gap-3">
                      <span className="w-44 shrink-0 truncate text-sm">
                        {area.serviceArea}
                      </span>
                      <span
                        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                        role="img"
                        aria-label={`${Math.round(area.completionPct * 100)}% complete`}
                      >
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${area.completionPct * 100}%` }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                        {Math.round(area.completionPct * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <Card>
          <CardHeader>
            <CardTitle>Open tasks</CardTitle>
            <CardDescription>
              Soonest due first; tasks with no date sort last. Full task
              management arrives in Phase 5.
            </CardDescription>
          </CardHeader>
          {vm.tasks.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No open tasks.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Service area</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Days left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vm.tasks.map((task) => (
                  <TableRow key={task.taskId}>
                    <TableCell className="font-medium">{task.taskName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {task.serviceArea}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {TASK_STATUS_LABELS[task.status as TaskStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {task.assignedTo ?? "Unassigned"}
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
      ) : null}

      {tab === "issues" ? (
        <Card>
          <CardHeader>
            <CardTitle>Open issues</CardTitle>
            <CardDescription>Most severe first.</CardDescription>
          </CardHeader>
          {vm.issues.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No open issues.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issue</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Raised</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vm.issues.map((issue) => (
                  <TableRow key={issue.issueId}>
                    <TableCell className="font-medium">{issue.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {issue.category ?? "—"}
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
                        {ISSUE_SEVERITY_LABELS[issue.severity as IssueSeverity]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {issue.owner ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmt(issue.dateRaised)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmt(issue.deadline)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}

      {tab === "requests" ? (
        <Card>
          <CardHeader>
            <CardTitle>Outstanding requests</CardTitle>
            <CardDescription>Longest waiting first.</CardDescription>
          </CardHeader>
          {vm.requests.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Nothing outstanding from this client.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Required by</TableHead>
                  <TableHead className="text-right">Days waiting</TableHead>
                  <TableHead>Bucket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vm.requests.map((request) => (
                  <TableRow key={request.requestId}>
                    <TableCell className="font-medium">
                      {request.title}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {
                          REQUEST_STATUS_LABELS[
                            request.status as keyof typeof REQUEST_STATUS_LABELS
                          ]
                        }
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmt(request.requestedDate)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmt(request.requiredBy)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {request.daysWaiting ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          request.daysWaitingBucket === "15+"
                            ? "danger"
                            : request.daysWaitingBucket === "8-14"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {request.daysWaitingBucket ?? "—"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}

      {tab === "contacts" ? (
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
            <CardDescription>
              The primary contact on the client record is{" "}
              {vm.clientContact ?? "not set"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContactsPanel
              clientId={id}
              contacts={detail.contacts}
              canEdit={canEdit}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === "services" ? (
        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>
              Included in the {vm.servicePackage ?? "—"} package. Changing the
              package changes which templates generate future work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No services linked to this package.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {detail.services.map((service) => (
                  <li key={service}>
                    <Badge variant="outline">{service}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "activity" ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              The 20 most recent events for this client.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activity recorded yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {detail.recentActivity.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{entry.action}</p>
                      {entry.previousValue || entry.newValue ? (
                        <p className="text-sm text-muted-foreground">
                          {entry.previousValue ? `${entry.previousValue} → ` : ""}
                          {entry.newValue ?? ""}
                        </p>
                      ) : null}
                    </div>
                    <p className="whitespace-nowrap text-xs text-muted-foreground">
                      {dateTimeFormatter.format(entry.createdAt)}
                      {entry.userEmail ? ` · ${entry.userEmail}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "notes" ? (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
            <CardDescription>
              Free-text notes on the client record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {vm.notes ? (
              <p className="whitespace-pre-wrap text-sm">{vm.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No notes recorded.
                {canEdit ? " Add them from the edit form." : ""}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}
