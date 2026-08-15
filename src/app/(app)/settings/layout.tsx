import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { SettingsNav } from "@/components/layout/settings-nav";
import { SETTINGS_NAV } from "@/lib/navigation";
import { hasPermission } from "@/server/auth/permissions";
import { getOrgContext } from "@/server/tenancy";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const items = SETTINGS_NAV.filter(
    (item) => !item.permission || hasPermission(ctx.role, item.permission),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Settings"
        description="Manage your organization, members, and account."
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <SettingsNav items={items} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
