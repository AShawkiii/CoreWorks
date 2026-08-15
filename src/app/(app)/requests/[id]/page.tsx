import { Clock, Pencil } from "lucide-react";
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
import { Priority, RequestStatus } from "@/generated/prisma/enums";
import { PRIORITY_LABELS, REQUEST_STATUS_LABELS } from "@/lib/domain/labels";
import { hasPermission } from "@/server/auth/permissions";
import {
  addRequestCommentAction,
  changeRequestStatusAction,
  deleteRequestCommentAction,
} from "@/server/actions/requests";
import { getRequestDetail } from "@/server/services/request-queries";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Request",
};

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

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "request:view")) notFound();

  const { id } = await params;

  const raw = await searchParams;
  const refusal = typeof raw.error === "string" ? raw.error : null;

  const detail = await getRequestDetail(ctx, id);
  if (!detail) notFound();

  const canEdit = hasPermission(ctx.role, "request:update");
  const { request } = detail;

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const fmt = (date: Date | null) => (date ? dateFormatter.format(date) : "—");

  // Requests have no state machine either — any status may follow any other,
  // as in the existing system.
  const otherStatuses = Object.values(RequestStatus).filter(
    (status) => status !== request.status,
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title={request.title}
        description={`${request.displayId} · ${request.clientName}`}
        actions={
          canEdit ? (
            <Link
              href={`/requests/${id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          ) : null
        }
      />

      {detail.stale ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Waiting {detail.daysWaiting} days — at or beyond this
            organization&rsquo;s {detail.staleDays}-day threshold.
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Marking a request Received stamps the date that stops the
                waiting clock.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormMessage status="error" message={refusal ?? undefined} />

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[request.status]}>
                  {REQUEST_STATUS_LABELS[request.status]}
                </Badge>
                <Badge
                  variant={
                    request.priority === Priority.CRITICAL
                      ? "danger"
                      : request.priority === Priority.HIGH
                        ? "warning"
                        : "neutral"
                  }
                >
                  {PRIORITY_LABELS[request.priority]}
                </Badge>
                {detail.bucket ? (
                  <Badge variant={detail.stale ? "danger" : "neutral"}>
                    {detail.daysWaiting}d waiting · {detail.bucket}
                  </Badge>
                ) : null}
              </div>

              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  {otherStatuses.map((status) => (
                    <form key={status} action={changeRequestStatusAction}>
                      <input type="hidden" name="requestId" value={id} />
                      <input type="hidden" name="status" value={status} />
                      <Button
                        type="submit"
                        size="sm"
                        variant={
                          status === RequestStatus.RECEIVED
                            ? "primary"
                            : "outline"
                        }
                      >
                        {REQUEST_STATUS_LABELS[status]}
                      </Button>
                    </form>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You do not have permission to change this request.
                </p>
              )}
            </CardContent>
          </Card>

          {detail.description || detail.resolution || detail.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Detail</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
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
                parentField="requestId"
                parentId={id}
                comments={detail.comments}
                currentUserId={ctx.userId}
                addAction={addRequestCommentAction}
                deleteAction={deleteRequestCommentAction}
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
                    href={`/clients/${request.clientId}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {request.clientName}
                  </Link>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {detail.clientDisplayId}
                  </span>
                </Detail>

                <Detail label="Assigned to">
                  {request.assignedToName ?? "Unassigned"}
                </Detail>
                <Detail label="Requested">{fmt(request.requestedDate)}</Detail>
                <Detail label="Required by">{fmt(request.requiredBy)}</Detail>
                <Detail label="Received">{fmt(request.receivedDate)}</Detail>
                <Detail label="Days waiting">
                  {detail.daysWaiting === null
                    ? "—"
                    : `${detail.daysWaiting} (${detail.bucket})`}
                </Detail>
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
