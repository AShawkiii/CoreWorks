import { Pencil, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
import { FormMessage } from "@/components/ui/form-message";
import { prisma } from "@/lib/db";
import { Priority, TaskStatus } from "@/generated/prisma/enums";
import {
  PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import { canUpdateTask, hasPermission } from "@/server/auth/permissions";
import {
  changeTaskStatusAction,
  deleteTaskAction,
} from "@/server/actions/tasks";
import { getTaskDetail } from "@/server/services/task-queries";
import { getOrgContext } from "@/server/tenancy";

import { CommentsPanel } from "./comments-panel";

export const metadata: Metadata = {
  title: "Task",
};

const STATUS_VARIANT: Record<
  TaskStatus,
  "neutral" | "primary" | "warning" | "danger" | "success"
> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "primary",
  WAITING_CLIENT: "warning",
  BLOCKED: "danger",
  IN_REVIEW: "primary",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "task:view")) notFound();

  const { id } = await params;

  // A refused status change comes back here with its reason (see
  // changeTaskStatusAction), rather than through a generic error boundary.
  const raw = await searchParams;
  const refusal = typeof raw.error === "string" ? raw.error : null;
  const detail = await getTaskDetail(ctx, id);
  if (!detail) notFound();

  const assignee = await prisma.task.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { assignedTo: { select: { userId: true } } },
  });
  const isAssignee = assignee?.assignedTo?.userId === ctx.userId;
  const canEdit = canUpdateTask(ctx.role, isAssignee);
  const canDelete = hasPermission(ctx.role, "task:delete");

  const { task } = detail;

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

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title={task.taskName}
        description={`${task.displayId} · ${task.serviceArea} · ${TASK_CATEGORY_LABELS[detail.taskCategory as keyof typeof TASK_CATEGORY_LABELS] ?? detail.taskCategory}`}
        actions={
          <div className="flex items-center gap-2">
            {canEdit ? (
              <Link
                href={`/tasks/${id}/edit`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Link>
            ) : null}
            {canDelete ? (
              <form action={deleteTaskAction}>
                <input type="hidden" name="taskId" value={id} />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="text-danger"
                >
                  <Trash2 aria-hidden="true" />
                  Delete
                </Button>
              </form>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Only moves the workflow permits are offered — the same state
                machine the existing system enforces.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormMessage status="error" message={refusal ?? undefined} />

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[task.status]}>
                  {TASK_STATUS_LABELS[task.status]}
                </Badge>
                {detail.daysOverdue > 0 ? (
                  <Badge variant="danger">
                    {detail.daysOverdue} day
                    {detail.daysOverdue === 1 ? "" : "s"} overdue
                  </Badge>
                ) : null}
              </div>

              {canEdit ? (
                detail.allowedTransitions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {task.status === TaskStatus.CANCELLED
                      ? "Cancelled is final. Create a new task instead of resuming this one."
                      : "No further transitions are available."}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {detail.allowedTransitions.map((status) => (
                      <form key={status} action={changeTaskStatusAction}>
                        <input type="hidden" name="taskId" value={id} />
                        <input type="hidden" name="status" value={status} />
                        <Button
                          type="submit"
                          size="sm"
                          variant={
                            status === TaskStatus.COMPLETED
                              ? "primary"
                              : "outline"
                          }
                        >
                          {TASK_STATUS_LABELS[status]}
                        </Button>
                      </form>
                    ))}
                  </div>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  You do not have permission to change this task&rsquo;s status.
                </p>
              )}
            </CardContent>
          </Card>

          {detail.description || detail.notes || detail.waitingFor ? (
            <Card>
              <CardHeader>
                <CardTitle>Detail</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                {detail.description ? (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Description
                    </p>
                    <p className="whitespace-pre-wrap">{detail.description}</p>
                  </div>
                ) : null}
                {detail.waitingFor ? (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Waiting for
                    </p>
                    <p>{detail.waitingFor}</p>
                  </div>
                ) : null}
                {detail.notes ? (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Notes</p>
                    <p className="whitespace-pre-wrap">{detail.notes}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
              <CardDescription>
                Visible to everyone in your organization.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CommentsPanel
                taskId={id}
                comments={detail.comments}
                currentUserId={ctx.userId}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status history</CardTitle>
              <CardDescription>
                Who moved this task, and when.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No status changes recorded yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {detail.history.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 text-sm last:border-0 last:pb-0"
                    >
                      <span>
                        {entry.fromStatus
                          ? `${TASK_STATUS_LABELS[entry.fromStatus]} → `
                          : ""}
                        <span className="font-medium">
                          {TASK_STATUS_LABELS[entry.toStatus]}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {dateTimeFormatter.format(entry.changedAt)}
                        {entry.changedByName ? ` · ${entry.changedByName}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-3">
                <Detail label="Client">
                  <Link
                    href={`/clients/${task.clientId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {task.clientName}
                  </Link>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {detail.clientDisplayId}
                  </span>
                </Detail>

                <Detail label="Priority">
                  <Badge
                    variant={
                      task.priority === Priority.CRITICAL
                        ? "danger"
                        : task.priority === Priority.HIGH
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {PRIORITY_LABELS[task.priority]}
                  </Badge>
                </Detail>

                <Detail label="Assigned to">
                  {task.assignedToName ?? "Unassigned"}
                </Detail>
                <Detail label="Reviewer">
                  {detail.reviewerName ?? "None"}
                </Detail>
                <Detail label="Review status">
                  {REVIEW_STATUS_LABELS[task.reviewStatus]}
                </Detail>
                <Detail label="Due date">
                  <span
                    className={cn(
                      detail.daysOverdue > 0 && "font-medium text-danger",
                    )}
                  >
                    {fmt(task.dueDate)}
                  </span>
                </Detail>
                <Detail label="Days remaining">
                  {detail.daysRemaining ?? "—"}
                </Detail>
                <Detail label="Start date">{fmt(detail.startDate)}</Detail>
                <Detail label="Completed">{fmt(task.completionDate)}</Detail>
                <Detail label="Period">{task.period ?? "—"}</Detail>
                <Detail label="Client dependency">
                  {detail.clientDependency ? "Yes" : "No"}
                </Detail>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}
