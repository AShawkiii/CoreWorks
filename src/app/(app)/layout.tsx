import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { NotificationBell } from "@/components/layout/notification-bell";
import { UserMenu } from "@/components/layout/user-menu";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { NAV_SECTIONS } from "@/lib/navigation";
import { hasPermission } from "@/server/auth/permissions";
import { countUnreadNotifications } from "@/server/services/notifications";
import { getOrganization } from "@/server/services/organization";
import { getOrgContext } from "@/server/tenancy";

/**
 * Authenticated shell.
 *
 * Navigation is filtered by role here, on the server, so a Viewer's HTML
 * never contains links to sections they cannot open. That is a usability and
 * information-disclosure measure — each route still authorizes independently.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const [organization, unreadNotifications] = await Promise.all([
    getOrganization(ctx),
    countUnreadNotifications(ctx),
  ]);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.permission || hasPermission(ctx.role, item.permission),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <AppShell
      sections={sections}
      organizationName={organization?.name ?? "CoreWorks"}
      logoUrl={organization?.logoUrl ?? null}
      notifications={<NotificationBell unread={unreadNotifications} />}
      userMenu={
        <UserMenu
          name={ctx.userName}
          roleLabel={ORG_ROLE_LABELS[ctx.role]}
        />
      }
    >
      {children}
    </AppShell>
  );
}
