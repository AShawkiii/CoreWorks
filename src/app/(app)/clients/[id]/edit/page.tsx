import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/server/auth/permissions";
import { getClientFormOptions } from "@/server/services/clients";
import { getOrgContext } from "@/server/tenancy";

import { ClientForm } from "../../client-form";

export const metadata: Metadata = {
  title: "Edit client",
};

function toDateInput(date: Date | null): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "client:update")) notFound();

  const { id } = await params;

  // Scoped by organizationId, so another tenant's id is simply not found.
  const client = await prisma.client.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: {
      id: true,
      name: true,
      companyName: true,
      industry: true,
      businessType: true,
      startDate: true,
      servicePackageId: true,
      accountManagerId: true,
      backupMemberId: true,
      contactName: true,
      email: true,
      phone: true,
      accountingSystem: true,
      reportingFrequency: true,
      monthEndClosingDay: true,
      contractStatus: true,
      priority: true,
      notes: true,
    },
  });
  if (!client) notFound();

  const options = await getClientFormOptions(ctx);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`Edit ${client.name}`}
        description="Changing contract status re-derives the client's health immediately."
      />

      <Card>
        <CardContent className="pt-6">
          <ClientForm
            mode="edit"
            packages={options.packages}
            members={options.members}
            values={{
              clientId: client.id,
              name: client.name,
              companyName: client.companyName ?? "",
              industry: client.industry ?? "",
              businessType: client.businessType ?? "",
              startDate: toDateInput(client.startDate),
              servicePackageId: client.servicePackageId ?? "",
              accountManagerId: client.accountManagerId ?? "",
              backupMemberId: client.backupMemberId ?? "",
              contactName: client.contactName ?? "",
              email: client.email ?? "",
              phone: client.phone ?? "",
              accountingSystem: client.accountingSystem ?? "",
              reportingFrequency: client.reportingFrequency ?? "",
              monthEndClosingDay:
                client.monthEndClosingDay === null
                  ? ""
                  : String(client.monthEndClosingDay),
              contractStatus: client.contractStatus,
              priority: client.priority,
              notes: client.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
