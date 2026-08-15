import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { NotificationBell } from "@/components/layout/notification-bell";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeModeSync } from "@/components/theme/theme-mode-sync";
import { ThemeStyle } from "@/components/theme/theme-style";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { NAV_SECTIONS } from "@/lib/navigation";
import { hasPermission } from "@/server/auth/permissions";
import { permissionForPath } from "@/server/auth/route-permissions";
import { countUnreadNotifications } from "@/server/services/notifications";
import { getOrganization } from "@/server/services/organization";
import { getEffectiveThemeMode, getThemeCss } from "@/server/services/theme";
import { getOrgContext } from "@/server/tenancy";
import { NONCE_HEADER, PATHNAME_HEADER } from "@/proxy";

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

  /*
   * Route permission, pre-checked HERE rather than only in the page.
   *
   * The pages still check for themselves and remain the authorization
   * boundary. What this adds is the HTTP status: `loading.tsx` opens a
   * Suspense boundary below this layout, so by the time a page runs, the shell
   * has flushed and 200 is committed. Refusing here — above the boundary —
   * lets `notFound()` actually set 404, which is what a cache or a crawler
   * needs in order not to treat a denied page as a valid one.
   */
  const requestHeaders = await headers();
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined;
  const pathname = requestHeaders.get(PATHNAME_HEADER);
  const required = pathname ? permissionForPath(pathname) : null;
  if (required && !hasPermission(ctx.role, required)) notFound();

  const [organization, unreadNotifications, brandCss, themeMode] =
    await Promise.all([
      getOrganization(ctx),
      countUnreadNotifications(ctx),
      // Phase 12. Rendered into the initial HTML, so the organization's
      // colours are correct on the first frame rather than after hydration.
      getThemeCss(ctx),
      getEffectiveThemeMode(ctx),
    ]);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.permission || hasPermission(ctx.role, item.permission),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <ThemeStyle css={brandCss} />
      <ThemeModeSync mode={themeMode.mode} nonce={nonce} />
      <AppShell
        sections={sections}
        organizationName={organization?.name ?? "CoreWorks"}
        logoUrl={organization?.logoUrl ?? null}
        notifications={<NotificationBell unread={unreadNotifications} />}
        themeMode={themeMode.mode}
        userMenu={
          <UserMenu name={ctx.userName} roleLabel={ORG_ROLE_LABELS[ctx.role]} />
        }
      >
        {children}
      </AppShell>
    </>
  );
}
