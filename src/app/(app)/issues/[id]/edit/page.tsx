import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { hasPermission } from "@/server/auth/permissions";
import {
  getIssueDetail,
  getIssueFormOptions,
} from "@/server/services/issue-queries";
import { getOrgContext } from "@/server/tenancy";

import { IssueForm } from "../../issue-form";

export const metadata: Metadata = {
  title: "Edit issue",
};

function toDateInput(date: Date | null): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default async function EditIssuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "issue:update")) notFound();

  const { id } = await params;
  const detail = await getIssueDetail(ctx, id);
  if (!detail) notFound();

  const options = await getIssueFormOptions(ctx);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`Edit ${detail.issue.title}`}
        description={`${detail.issue.displayId} · ${detail.issue.clientName}`}
      />

      <Card>
        <CardContent className="pt-6">
          <IssueForm
            mode="edit"
            clients={options.clients}
            members={options.members}
            categories={options.categories}
            values={{
              issueId: detail.issue.id,
              clientId: detail.issue.clientId,
              title: detail.issue.title,
              category: detail.issue.category ?? "",
              impact: detail.impact ?? "",
              description: detail.description ?? "",
              severity: detail.issue.severity,
              assignedToId: detail.assignedToId ?? "",
              dateRaised: toDateInput(detail.issue.dateRaised),
              deadline: toDateInput(detail.issue.deadline),
              requiredAction: detail.issue.requiredAction ?? "",
              notes: detail.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
