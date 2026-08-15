import { describe, expect, it } from "vitest";

import { OrgRole } from "@/generated/prisma/enums";
import { NAV_SECTIONS, SETTINGS_NAV } from "@/lib/navigation";
import { hasPermission } from "@/server/auth/permissions";
import {
  permissionForPath,
  routePermissionEntries,
} from "@/server/auth/route-permissions";

/**
 * The layout-level route guard (Phase 14).
 *
 * This is what makes a permission refusal return **404** rather than the 200
 * carried as a known defect since Phase 4. The cause was measured: the
 * `(app)/loading.tsx` Suspense boundary flushes the shell and commits 200
 * before a page can call `notFound()`. Checking in the layout — above that
 * boundary — sets the status correctly and keeps the loading skeleton.
 *
 * The pages still check for themselves; this is a second gate in front of
 * them, so these tests care about the map being *derived correctly*, not about
 * it being the only defence.
 */

describe("permissionForPath", () => {
  it("matches an exact route", () => {
    expect(permissionForPath("/activity")).toBe("activity:view");
    expect(permissionForPath("/clients")).toBe("client:view");
    expect(permissionForPath("/settings/members")).toBe("member:view");
  });

  it("matches a detail page through its section", () => {
    // A section's detail pages are part of the section: /clients/CL-0007
    // needs client:view exactly as /clients does.
    expect(permissionForPath("/clients/abc-123")).toBe("client:view");
    expect(permissionForPath("/tasks/abc-123/edit")).toBe("task:view");
    expect(permissionForPath("/monthly-close/abc-123")).toBe("close:view");
  });

  it("prefers the longest matching route", () => {
    // /settings/members must not be decided by a shorter /settings entry.
    expect(permissionForPath("/settings/members")).toBe("member:view");
    expect(permissionForPath("/settings/security")).toBe("settings:manage");
    expect(permissionForPath("/settings/data")).toBe("data:export");
  });

  it("does not match a route that merely shares a prefix string", () => {
    // "/clients-archive" starts with "/clients" as a STRING but is a
    // different route; only a full segment boundary counts.
    expect(permissionForPath("/clientsomething")).toBeNull();
  });

  it("returns null where navigation declares no permission", () => {
    // Notifications are addressed to a user id, so no role gates them.
    expect(permissionForPath("/notifications")).toBeNull();
    expect(permissionForPath("/settings/profile")).toBeNull();
  });

  it("returns null for an unknown path rather than guessing", () => {
    expect(permissionForPath("/nope")).toBeNull();
    expect(permissionForPath("/")).toBeNull();
  });

  it("tolerates a trailing slash", () => {
    expect(permissionForPath("/activity/")).toBe("activity:view");
  });
});

describe("the map is derived from navigation", () => {
  const declared = [
    ...NAV_SECTIONS.flatMap((section) => section.items),
    ...SETTINGS_NAV,
  ].filter((item) => item.href && item.permission);

  it("covers every route navigation declares a permission for", () => {
    for (const item of declared) {
      expect(
        permissionForPath(item.href as string),
        `${item.href} should resolve to ${item.permission}`,
      ).toBe(item.permission);
    }
  });

  it("adds nothing navigation did not declare", () => {
    const declaredRoutes = new Set(declared.map((item) => item.href as string));
    for (const [route] of routePermissionEntries()) {
      expect(declaredRoutes.has(route), `${route} is not in navigation`).toBe(
        true,
      );
    }
  });

  it("lists each route once, even when two menus declare it", () => {
    // /settings/organization is reachable from the sidebar and from the
    // settings index. Both declare it; the map holds it once.
    const routes = routePermissionEntries().map(([route]) => route);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toContain("/settings/organization");
  });

  it("is sorted longest-first, so prefix matching is deterministic", () => {
    const lengths = routePermissionEntries().map(([route]) => route.length);
    for (let i = 1; i < lengths.length; i += 1) {
      expect(lengths[i - 1]!).toBeGreaterThanOrEqual(lengths[i]!);
    }
  });

  it("names only permissions the matrix knows", () => {
    for (const [route, permission] of routePermissionEntries()) {
      expect(
        hasPermission(OrgRole.OWNER, permission),
        `${route} names unknown permission "${permission}"`,
      ).toBe(true);
    }
  });
});

describe("the guard agrees with the roles it is meant to stop", () => {
  const cases: [string, OrgRole, boolean][] = [
    ["/activity", OrgRole.OWNER, true],
    ["/activity", OrgRole.MANAGER, true],
    ["/activity", OrgRole.ACCOUNTANT, false],
    ["/activity", OrgRole.VIEWER, false],
    ["/settings/security", OrgRole.ADMIN, true],
    ["/settings/security", OrgRole.MANAGER, false],
    ["/settings/data", OrgRole.TEAM_MEMBER, true],
    ["/settings/data", OrgRole.VIEWER, false],
    ["/clients/abc", OrgRole.VIEWER, true],
  ];

  for (const [path, role, allowed] of cases) {
    it(`${role} ${allowed ? "reaches" : "is refused"} ${path}`, () => {
      const required = permissionForPath(path);
      const permitted = required === null || hasPermission(role, required);
      expect(permitted).toBe(allowed);
    });
  }
});
