import type { Permission } from "@/server/auth/permissions";
import { NAV_SECTIONS, SETTINGS_NAV } from "@/lib/navigation";

/**
 * Which permission a route requires — derived from the navigation, not
 * restated.
 *
 * `NAV_SECTIONS` and `SETTINGS_NAV` already declare a `permission` beside each
 * `href`, because the sidebar has to hide what a role cannot open. Deriving
 * this map from the same declaration means the sidebar, the layout guard, and
 * the page cannot disagree about who may reach a route — a second hand-written
 * table would be a place for them to drift apart.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 *
 * Every page already calls `hasPermission(...)` and `notFound()` itself, and
 * that remains the authorization boundary. The problem this solves is the HTTP
 * **status**, carried as a known defect since Phase 4:
 *
 * > *"An unauthorized page request calls `notFound()`, which renders the
 * > not-found body but returns HTTP 200 rather than 404."*
 *
 * The cause, measured rather than assumed: `(app)/loading.tsx` creates a
 * Suspense boundary, so Next flushes the shell — and commits `200` — before
 * the page component runs. A `notFound()` after that can replace the body but
 * not the status. Removing `loading.tsx` fixes the status and loses the
 * skeleton; checking in the **layout**, which runs above that boundary, fixes
 * the status and keeps it. Both were verified live before choosing.
 *
 * The page checks stay exactly as they are. This is a second gate in front of
 * them, not a replacement: a route absent from this map is simply not
 * pre-checked, and its page still refuses on its own.
 *
 * **This fixes the permission half only.** Whether a record belongs to this
 * tenant needs a database read, which can only happen in the page — below the
 * boundary that has already committed the status — so a record-level
 * `notFound()` still returns 200 with the not-found body and no data. Route
 * permission is decidable from the path alone, which is why it could move
 * above the boundary and record identity cannot. `docs/security.md` records
 * the measurements and the either/or that remains.
 */

/**
 * Longest-prefix route → permission, built once at module load.
 *
 * A route may legitimately appear in both lists — `/settings/organization` is
 * reachable from the sidebar and from the settings index — so declarations are
 * collapsed by route. A *conflicting* second declaration is a different thing
 * entirely: it would mean the sidebar and this guard disagree about who may
 * open a page, and silently keeping the first would hide that. It throws at
 * module load instead, where a test and the build both see it.
 */
const ROUTE_PERMISSIONS: [string, Permission][] = (() => {
  const byRoute = new Map<string, Permission>();

  for (const item of [
    ...NAV_SECTIONS.flatMap((section) => section.items),
    ...SETTINGS_NAV,
  ]) {
    if (!item.href || !item.permission) continue;
    const route = item.href as string;
    const existing = byRoute.get(route);
    if (existing && existing !== item.permission) {
      throw new Error(
        `Navigation declares ${route} with two permissions: ` +
          `"${existing}" and "${item.permission}".`,
      );
    }
    byRoute.set(route, item.permission);
  }

  // Longest first, so `/settings/members` wins over a hypothetical `/settings`.
  return [...byRoute.entries()].sort(([a], [b]) => b.length - a.length);
})();

/**
 * The permission a pathname requires, or null when the navigation declares
 * none.
 *
 * Matched on the route prefix so a detail page inherits its section's rule:
 * `/clients/CL-0007` needs `client:view` exactly as `/clients` does. That is
 * the correct default — a section's detail pages are part of the section — and
 * where a page needs something *narrower* it keeps its own stricter check,
 * which still runs.
 */
export function permissionForPath(pathname: string): Permission | null {
  const path = pathname.replace(/\/+$/, "") || "/";

  for (const [route, permission] of ROUTE_PERMISSIONS) {
    if (path === route || path.startsWith(`${route}/`)) return permission;
  }
  return null;
}

/** Exposed for the test that asserts the map covers what navigation declares. */
export function routePermissionEntries(): readonly [string, Permission][] {
  return ROUTE_PERMISSIONS;
}
