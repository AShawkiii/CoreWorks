import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ContractStatus, Priority } from "@/generated/prisma/enums";
import { hasPermission } from "@/server/auth/permissions";
import { getClientFormOptions } from "@/server/services/clients";
import { getOrgContext } from "@/server/tenancy";

import { ClientForm } from "../client-form";

export const metadata: Metadata = {
  title: "New client",
};

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default async function NewClientPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "client:create")) notFound();

  const options = await getClientFormOptions(ctx);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="New client"
        description="Onboarding tasks generate automatically from the service package."
      />

      <Card>
        <CardContent className="pt-6">
          <ClientForm
            mode="create"
            packages={options.packages}
            members={options.members}
            values={{
              name: "",
              companyName: "",
              industry: "",
              businessType: "",
              startDate: today(),
              servicePackageId: "",
              accountManagerId: "",
              backupMemberId: "",
              contactName: "",
              email: "",
              phone: "",
              accountingSystem: "",
              reportingFrequency: "",
              monthEndClosingDay: "",
              contractStatus: ContractStatus.ONBOARDING,
              priority: Priority.MEDIUM,
              notes: "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
