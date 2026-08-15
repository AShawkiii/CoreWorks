import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Interim dashboard.
 *
 * The real Control Center arrives in Phase 7, built on the 14-KPI view model
 * ported in Phase 3 (audit §8.2). The counts here are deliberately raw
 * record counts — not the legacy KPIs — because those KPIs have precise
 * definitions that Phase 3 owns, and approximating them now would put a
 * plausible-looking wrong number in front of users.
 */
export default async function DashboardPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const scope = { organizationId: ctx.organizationId, deletedAt: null };

  const [clients, members, tasks, issues, requests] = await Promise.all([
    prisma.client.count({ where: scope }),
    prisma.organizationMember.count({
      where: { organizationId: ctx.organizationId, isActive: true, deletedAt: null },
    }),
    prisma.task.count({ where: scope }),
    prisma.issue.count({ where: scope }),
    prisma.clientRequest.count({ where: scope }),
  ]);

  const stats = [
    { label: "Clients", value: clients },
    { label: "Active members", value: members },
    { label: "Tasks", value: tasks },
    { label: "Issues", value: issues },
    { label: "Requests", value: requests },
    { label: "Your permissions", value: ROLE_PERMISSIONS[ctx.role].length },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title={`Welcome back, ${ctx.userName.split(" ")[0]}`}
        description={`Signed in to ${ctx.organizationSlug} as ${ORG_ROLE_LABELS[ctx.role]}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">
                {stat.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Record counts, not KPIs</CardTitle>
          <CardDescription>
            These are plain counts of records in your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            The Control Center&rsquo;s fourteen KPIs — overdue tasks, clients
            at risk, weighted completion, issues needing attention — have
            precise definitions carried over from the existing system. They
            arrive in Phase 7, once those rules are ported and verified against
            the original in Phase 3.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
