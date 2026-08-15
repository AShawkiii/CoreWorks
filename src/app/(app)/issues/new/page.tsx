import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { IssueSeverity } from "@/generated/prisma/enums";
import { hasPermission } from "@/server/auth/permissions";
import { getIssueFormOptions } from "@/server/services/issue-queries";
import { getOrgContext } from "@/server/tenancy";

import { IssueForm } from "../issue-form";

export const metadata: Metadata = {
  title: "Raise issue",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewIssuePage({ searchParams }: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "issue:create")) notFound();

  const options = await getIssueFormOptions(ctx);
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
        title="Raise issue"
        description="Issues drive client health: an open Critical marks a client Delayed, an open High marks them At Risk."
      />

      <Card>
        <CardContent className="pt-6">
          <IssueForm
            mode="create"
            clients={options.clients}
            members={options.members}
            categories={options.categories}
            values={{
              clientId: presetClient,
              title: "",
              category: "",
              impact: "",
              description: "",
              severity: IssueSeverity.MEDIUM,
              assignedToId: "",
              dateRaised: "",
              deadline: "",
              requiredAction: "",
              notes: "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
