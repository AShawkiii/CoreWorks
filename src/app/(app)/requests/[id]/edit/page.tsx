import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { hasPermission } from "@/server/auth/permissions";
import {
  getRequestDetail,
  getRequestFormOptions,
} from "@/server/services/request-queries";
import { getOrgContext } from "@/server/tenancy";

import { RequestForm } from "../../request-form";

export const metadata: Metadata = {
  title: "Edit request",
};

function toDateInput(date: Date | null): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default async function EditRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "request:update")) notFound();

  const { id } = await params;
  const detail = await getRequestDetail(ctx, id);
  if (!detail) notFound();

  const options = await getRequestFormOptions(ctx);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`Edit ${detail.request.title}`}
        description={`${detail.request.displayId} · ${detail.request.clientName}`}
      />

      <Card>
        <CardContent className="pt-6">
          <RequestForm
            mode="edit"
            clients={options.clients}
            members={options.members}
            values={{
              requestId: detail.request.id,
              clientId: detail.request.clientId,
              title: detail.request.title,
              description: detail.description ?? "",
              priority: detail.request.priority,
              assignedToId: detail.assignedToId ?? "",
              requestedDate: toDateInput(detail.request.requestedDate),
              requiredBy: toDateInput(detail.request.requiredBy),
              notes: detail.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
