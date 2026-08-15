import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { canUpdateTask } from "@/server/auth/permissions";
import {
  getTaskDetail,
  getTaskFormOptions,
} from "@/server/services/task-queries";
import { getOrgContext } from "@/server/tenancy";

import { TaskForm } from "../../task-form";

export const metadata: Metadata = {
  title: "Edit task",
};

function toDateInput(date: Date | null): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default async function EditTaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const { id } = await params;
  const detail = await getTaskDetail(ctx, id);
  if (!detail) notFound();

  // A Team Member holds task:update_own, so the check needs the assignee.
  const assignee = await prisma.task.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { assignedTo: { select: { userId: true } } },
  });
  const isAssignee = assignee?.assignedTo?.userId === ctx.userId;
  if (!canUpdateTask(ctx.role, isAssignee)) notFound();

  const options = await getTaskFormOptions(ctx);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`Edit ${detail.task.taskName}`}
        description={`${detail.task.displayId} · ${detail.task.clientName}`}
      />

      <Card>
        <CardContent className="pt-6">
          <TaskForm
            mode="edit"
            clients={options.clients}
            members={options.members}
            serviceAreas={options.serviceAreas}
            values={{
              taskId: detail.task.id,
              clientId: detail.task.clientId,
              taskName: detail.task.taskName,
              serviceArea: detail.task.serviceArea,
              description: detail.description ?? "",
              period: detail.task.period ?? "",
              assignedToId: detail.assignedToId ?? "",
              reviewerId: detail.reviewerId ?? "",
              priority: detail.task.priority,
              dueDate: toDateInput(detail.task.dueDate),
              startDate: toDateInput(detail.startDate),
              reviewStatus: detail.task.reviewStatus,
              clientDependency: detail.clientDependency,
              waitingFor: detail.waitingFor ?? "",
              notes: detail.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
