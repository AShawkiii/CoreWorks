import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Priority } from "@/generated/prisma/enums";
import { hasPermission } from "@/server/auth/permissions";
import { getRequestFormOptions } from "@/server/services/request-queries";
import { getOrgContext } from "@/server/tenancy";

import { RequestForm } from "../request-form";

export const metadata: Metadata = {
  title: "Raise request",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewRequestPage({ searchParams }: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "request:create")) notFound();

  const options = await getRequestFormOptions(ctx);
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
        title="Raise request"
        description="Something needed from the client. The waiting clock starts on the requested date and stops when it is marked Received."
      />

      <Card>
        <CardContent className="pt-6">
          <RequestForm
            mode="create"
            clients={options.clients}
            members={options.members}
            values={{
              clientId: presetClient,
              title: "",
              description: "",
              priority: Priority.MEDIUM,
              assignedToId: "",
              requestedDate: "",
              requiredBy: "",
              notes: "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
