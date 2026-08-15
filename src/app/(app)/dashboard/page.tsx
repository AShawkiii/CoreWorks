import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { prisma } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/server/auth/permissions";
import { getOrgContext } from "@/server/tenancy";

import { signOutAction } from "./actions";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Phase 1 placeholder.
 *
 * The real Control Center arrives in Phase 7, built on the 14-KPI view model
 * ported in Phase 3 (audit §8.2). This page exists to prove the Phase 1
 * wiring end to end: session → organization context → role → tenant-scoped
 * query, all server-side.
 */
export default async function DashboardPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  // Every count is scoped by organizationId from the session — never from a
  // request parameter (master prompt §6).
  const [clientCount, memberCount] = await Promise.all([
    prisma.client.count({
      where: { organizationId: ctx.organizationId, deletedAt: null },
    }),
    prisma.organizationMember.count({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        deletedAt: null,
      },
    }),
  ]);

  const permissionCount = ROLE_PERMISSIONS[ctx.role].length;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <form action={signOutAction}>
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {ctx.userName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in to {ctx.organizationSlug} as{" "}
          {ORG_ROLE_LABELS[ctx.role]}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Clients</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {clientCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active team members</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {memberCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Your permissions</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {permissionCount}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Phase 1 complete</CardTitle>
          <CardDescription>
            Database, authentication, multi-tenancy, and the design-token
            system are in place.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Phase 2 adds organization and member management. Phase 3 ports the
            legacy business rules with the parity test suite before any
            dashboard is built on them.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
