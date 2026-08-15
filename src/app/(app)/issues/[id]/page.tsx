import { AlertTriangle, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CommentsPanel } from "@/components/comments/comments-panel";
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
import { IssueSeverity, IssueStatus } from "@/generated/prisma/enums";
import {
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
} from "@/lib/domain/labels";
import { hasPermission } from "@/server/auth/permissions";
import {
  addIssueCommentAction,
  changeIssueStatusAction,
  deleteIssueCommentAction,
} from "@/server/actions/issues";
import { getIssueDetail } from "@/server/services/issue-queries";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Issue",
};

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

export default async function IssueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "issue:view")) notFound();

  const { id } = await params;

  const raw = await searchParams;
  const refusal = typeof raw.error === "string" ? raw.error : null;

  const detail = await getIssueDetail(ctx, id);
  if (!detail) notFound();

  const canEdit = hasPermission(ctx.role, "issue:update");
  const { issue } = detail;

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const fmt = (date: Date | null) => (date ? dateFormatter.format(date) : "—");

  // Issues have no state machine — legacy's onEdit routed only TASKS.Status,
  // so any status may follow any other. Every status but the current one is
  // offered.
  const otherStatuses = Object.values(IssueStatus).filter(
    (status) => status !== issue.status,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title={issue.title}
        description={`${issue.displayId} · ${issue.clientName}${issue.category ? ` · ${issue.category}` : ""}`}
        actions={
          canEdit ? (
            <Link
              href={`/issues/${id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          ) : null
        }
      />

      {detail.open && (detail.criticalOrHigh || detail.overdue) ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            This issue is surfaced on the Control Center
            {detail.criticalOrHigh && detail.overdue
              ? " — unresolved at high severity, and past its deadline."
              : detail.criticalOrHigh
                ? " — unresolved at Critical or High severity."
                : " — unresolved and past its deadline."}
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Issues have no fixed workflow — any status may follow any
                other, as in the existing system. Resolving stamps a resolution
                date.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormMessage status="error" message={refusal ?? undefined} />

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[issue.status]}>
                  {ISSUE_STATUS_LABELS[issue.status]}
                </Badge>
                <Badge variant={SEVERITY_VARIANT[issue.severity]}>
                  {ISSUE_SEVERITY_LABELS[issue.severity]}
                </Badge>
                {detail.overdue ? (
                  <Badge variant="danger">Past deadline</Badge>
                ) : null}
              </div>

              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  {otherStatuses.map((status) => (
                    <form key={status} action={changeIssueStatusAction}>
                      <input type="hidden" name="issueId" value={id} />
                      <input type="hidden" name="status" value={status} />
                      <Button
                        type="submit"
                        size="sm"
                        variant={
                          status === IssueStatus.RESOLVED ? "primary" : "outline"
                        }
                      >
                        {ISSUE_STATUS_LABELS[status]}
                      </Button>
                    </form>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You do not have permission to change this issue.
                </p>
              )}
            </CardContent>
          </Card>

          {detail.impact ||
          issue.requiredAction ||
          detail.description ||
          detail.resolution ||
          detail.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Detail</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                {detail.impact ? (
                  <Field label="Impact">{detail.impact}</Field>
                ) : null}
                {issue.requiredAction ? (
                  <Field label="Required action">{issue.requiredAction}</Field>
                ) : null}
                {detail.description ? (
                  <Field label="Description">{detail.description}</Field>
                ) : null}
                {detail.resolution ? (
                  <Field label="Resolution">{detail.resolution}</Field>
                ) : null}
                {detail.notes ? (
                  <Field label="Notes">{detail.notes}</Field>
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
                parentField="issueId"
                parentId={id}
                comments={detail.comments}
                currentUserId={ctx.userId}
                addAction={addIssueCommentAction}
                deleteAction={deleteIssueCommentAction}
              />
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
                    href={`/clients/${issue.clientId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {issue.clientName}
                  </Link>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {detail.clientDisplayId}
                  </span>
                </Detail>

                <Detail label="Category">{issue.category ?? "—"}</Detail>
                <Detail label="Assigned to">
                  {issue.assignedToName ?? "Unassigned"}
                </Detail>
                <Detail label="Date raised">{fmt(issue.dateRaised)}</Detail>
                <Detail label="Deadline">
                  <span className={detail.overdue ? "text-danger" : undefined}>
                    {fmt(issue.deadline)}
                  </span>
                </Detail>
                <Detail label="Resolved">{fmt(detail.resolutionDate)}</Detail>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap">{children}</p>
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
