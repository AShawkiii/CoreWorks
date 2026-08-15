import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Priority, ReviewStatus } from "@/generated/prisma/enums";
import { hasPermission } from "@/server/auth/permissions";
import { getTaskFormOptions } from "@/server/services/task-queries";
import { getOrgContext } from "@/server/tenancy";

import { TaskForm } from "../task-form";

export const metadata: Metadata = {
  title: "New task",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewTaskPage({ searchParams }: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "task:create")) notFound();

  const options = await getTaskFormOptions(ctx);
  const raw = await searchParams;

  // Arriving from a client page pre-selects that client.
  const presetClient =
    typeof raw.clientId === "string" &&
    options.clients.some((client) => client.id === raw.clientId)
      ? raw.clientId
      : "";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="New task"
        description="Ad-hoc work. Recurring tasks are generated from service package templates."
      />

      <Card>
        <CardContent className="pt-6">
          <TaskForm
            mode="create"
            clients={options.clients}
            members={options.members}
            serviceAreas={options.serviceAreas}
            values={{
              clientId: presetClient,
              taskName: "",
              serviceArea: "",
              description: "",
              period: "",
              assignedToId: "",
              reviewerId: "",
              priority: Priority.MEDIUM,
              dueDate: "",
              startDate: "",
              reviewStatus: ReviewStatus.NOT_REVIEWED,
              clientDependency: false,
              waitingFor: "",
              notes: "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
