import { Info } from "lucide-react";
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
import { CloseStageStatus, CloseStatus } from "@/generated/prisma/enums";
import {
  CLOSE_STAGE_STATUS_LABELS,
  CLOSE_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
} from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/auth/permissions";
import { changeStageStatusAction } from "@/server/actions/monthly-close";
import { getCloseDetail } from "@/server/services/monthly-close";
import { getOrgContext } from "@/server/tenancy";

import { CloseNotesForm } from "./close-notes-form";

export const metadata: Metadata = {
  title: "Monthly close",
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

const STAGE_TONE: Record<CloseStageStatus, string> = {
  NOT_STARTED: "border-border bg-card",
  IN_PROGRESS: "border-primary/40 bg-primary/5",
  COMPLETED: "border-success/40 bg-success/10",
  BLOCKED: "border-danger/40 bg-danger/10",
  WAITING_CLIENT: "border-warning/40 bg-warning/10",
};

/**
 * A single monthly close (audit §6.13).
 *
 * Two completion figures appear here and they are NOT interchangeable:
 *
 *  - **Stage completion** — the eighteen close stages, the number legacy's
 *    MONTHLY_CLOSE row carried.
 *  - **Task completion** — every task for the client in that period, which
 *    legacy's close dashboard counted regardless of service area.
 *
 * The page labels both rather than showing one figure and letting the reader
 * guess which question it answers.
 */
export default async function CloseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "close:view")) notFound();

  const { id } = await params;
  const raw = await searchParams;
  const refusal = typeof raw.error === "string" ? raw.error : null;

  const close = await getCloseDetail(ctx, id);
  if (!close) notFound();

  const canManage = hasPermission(ctx.role, "close:manage");
  const canViewTasks = hasPermission(ctx.role, "task:view");
  const canViewClients = hasPermission(ctx.role, "client:view");

  const summary = close.taskSummary;
  const stagesCompleted = close.stages.filter(
    (s) => s.status === CloseStageStatus.COMPLETED,
  ).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`${close.clientName} — ${close.period}`}
        description={`${close.displayId} · ${close.clientDisplayId}`}
        actions={
          canViewClients ? (
            <Link
              href={`/clients/${close.clientId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open client
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="Close status">
          <Badge variant={STATUS_VARIANT[close.status]}>
            {CLOSE_STATUS_LABELS[close.status]}
          </Badge>
        </Summary>
        <Summary label="Stage completion">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">
            {Math.round(close.completionPct * 100)}%
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {stagesCompleted}/{close.stages.length}
          </span>
        </Summary>
        <Summary label="Review">
          {REVIEW_STATUS_LABELS[close.reviewStatus]}
        </Summary>
        <Summary label="Closed">
          {close.closedAt
            ? new Intl.DateTimeFormat("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }).format(close.closedAt)
            : "—"}
        </Summary>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Close stages</CardTitle>
              <CardDescription>
                The eighteen stages in the order the existing checklist runs
                them. Any stage may move to any status — there is no fixed
                sequence — and the close status above re-derives on every
                change.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FormMessage status="error" message={refusal ?? undefined} />

              <ol className="grid gap-2 sm:grid-cols-2">
                {close.stages.map((stage, index) => (
                  <li
                    key={stage.id}
                    className={cn(
                      "rounded-lg border p-3",
                      STAGE_TONE[stage.status],
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">
                          {index + 1}
                        </span>
                        {stage.stageName}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {CLOSE_STAGE_STATUS_LABELS[stage.status]}
                      </span>
                    </div>

                    {canManage ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {Object.values(CloseStageStatus)
                          .filter((status) => status !== stage.status)
                          .map((status) => (
                            <form key={status} action={changeStageStatusAction}>
                              <input
                                type="hidden"
                                name="closeId"
                                value={close.id}
                              />
                              <input
                                type="hidden"
                                name="stageId"
                                value={stage.id}
                              />
                              <input
                                type="hidden"
                                name="status"
                                value={status}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                variant={
                                  status === CloseStageStatus.COMPLETED
                                    ? "primary"
                                    : "outline"
                                }
                                className="h-7 px-2 text-xs"
                              >
                                {CLOSE_STAGE_STATUS_LABELS[status]}
                              </Button>
                            </form>
                          ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Work this period</CardTitle>
              <CardDescription>
                Every task for {close.clientName} in {close.period}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Completion" value={`${Math.round(summary.completionPct * 100)}%`} />
                <Stat label="Completed" value={summary.completed} />
                <Stat label="Pending" value={summary.pending} />
                <Stat
                  label="Overdue"
                  value={summary.overdue}
                  tone={summary.overdue > 0 ? "danger" : undefined}
                />
                <Stat
                  label="Waiting client"
                  value={summary.waitingClient}
                  tone={summary.waitingClient > 0 ? "warning" : undefined}
                />
                <Stat
                  label="Blocked"
                  value={summary.blocked}
                  tone={summary.blocked > 0 ? "danger" : undefined}
                />
              </div>

              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  This counts every deliverable due in the period, not only
                  Month-End Closing work — so it is a different figure from the
                  stage completion above. Pending excludes blocked and
                  waiting-client work, which have their own counts.
                </span>
              </p>

              {canViewTasks ? (
                <Link
                  href={{
                    pathname: "/tasks",
                    query: {
                      clientId: close.clientId,
                      period: close.period,
                      status: "ALL",
                    },
                  }}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Open {close.periodTasks.length} task
                  {close.periodTasks.length === 1 ? "" : "s"}
                </Link>
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Review</CardTitle>
                <CardDescription>
                  Close status and completion are derived from the stages and
                  cannot be set here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CloseNotesForm
                  closeId={close.id}
                  reviewStatus={close.reviewStatus}
                  notes={close.notes ?? ""}
                />
              </CardContent>
            </Card>
          ) : close.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{close.notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Summary({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1.5 text-sm font-medium">{children}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warning" | "danger";
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
    </div>
  );
}
