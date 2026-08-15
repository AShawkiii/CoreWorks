import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { getOrgContext } from "@/server/tenancy";

import { ChangePasswordForm, ProfileForm } from "./profile-forms";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfileSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const permissions = [...ROLE_PERMISSIONS[ctx.role]].sort();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Your profile</CardTitle>
          <CardDescription>
            How you appear to the rest of your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm name={ctx.userName} email={ctx.userEmail} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Changing your password signs out any pending reset links.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
          <CardDescription>
            You are a {ORG_ROLE_LABELS[ctx.role]} in {ctx.organizationSlug},
            with {permissions.length} permissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-1.5">
            {permissions.map((permission) => (
              <li key={permission}>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {permission}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
