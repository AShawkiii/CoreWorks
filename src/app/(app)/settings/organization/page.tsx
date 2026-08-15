import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasPermission } from "@/server/auth/permissions";
import { getOrganization } from "@/server/services/organization";
import { getOrgContext } from "@/server/tenancy";

import { OrganizationForm } from "./organization-form";

export const metadata: Metadata = {
  title: "Organization settings",
};

export default async function OrganizationSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "org:view")) notFound();

  const organization = await getOrganization(ctx);
  if (!organization) notFound();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          Identity and regional defaults for {organization.name}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OrganizationForm
          organization={organization}
          canEdit={hasPermission(ctx.role, "org:manage")}
        />
      </CardContent>
    </Card>
  );
}
