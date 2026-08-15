import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrgRole } from "@/generated/prisma/enums";
import { canManageRole, hasPermission } from "@/server/auth/permissions";
import { listMembers } from "@/server/services/members";
import { getOrgContext } from "@/server/tenancy";

import { InviteMemberForm } from "./invite-member-form";
import { MembersTable } from "./members-table";

export const metadata: Metadata = {
  title: "Members",
};

export default async function MembersSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "member:view")) notFound();

  const members = await listMembers(ctx);
  const canManage = hasPermission(ctx.role, "member:manage");

  // Only roles strictly junior to the caller's are offered. The server
  // enforces the same rule — this keeps the UI from presenting a choice that
  // would be rejected.
  const assignableRoles = Object.values(OrgRole).filter((role) =>
    canManageRole(ctx.role, role),
  );

  const activeCount = members.filter((member) => member.isActive).length;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {activeCount} active of {members.length} total. Access roles
            control what a member can do; job titles decide how work is
            assigned from templates.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <MembersTable
            members={members}
            assignableRoles={assignableRoles}
            canManage={canManage}
          />
        </CardContent>
      </Card>

      {canManage ? <InviteMemberForm assignableRoles={assignableRoles} /> : null}
    </div>
  );
}
