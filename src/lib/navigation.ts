import type { Route } from "next";

import type { Permission } from "@/server/auth/permissions";

/**
 * Sidebar structure (master prompt §32).
 *
 * The full information architecture is declared here from the start so the
 * navigation does not change shape phase by phase. Items whose feature has
 * not been built yet are marked `phase` and render as disabled with the phase
 * number — visibly not-yet-available rather than a link to an empty page
 * pretending to be a feature.
 *
 * `permission` filters what a role can even see. Filtering is applied on the
 * server; it is a usability measure, not the security boundary — the routes
 * themselves re-check (see src/server/tenancy.ts).
 *
 * Icons are referenced by NAME, not by component. This module is consumed by
 * Server Components and handed to Client Components, and a React component is
 * a function — not serializable across that boundary. The name is resolved to
 * a component inside the client navigation (src/components/layout/nav-icons.ts).
 */

export type NavIconName =
  | "dashboard"
  | "clients"
  | "tasks"
  | "issues"
  | "requests"
  | "team"
  | "close"
  | "templates"
  | "services"
  | "packages"
  | "clientDashboard"
  | "report"
  | "activity"
  | "notifications"
  | "settings"
  | "profile";

export interface NavItem {
  label: string;
  icon: NavIconName;
  /** Present when the route exists; absent while the feature is unbuilt. */
  href?: Route;
  /** Phase that delivers this item; omitted once delivered. */
  phase?: number;
  permission?: Permission;
}

export interface NavSection {
  label: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [
      {
        label: "Dashboard",
        icon: "dashboard",
        href: "/dashboard",
        // The Control Center gates on report:view (every role holds it today).
        // Declaring it here keeps the sidebar and the page from disagreeing if
        // a later phase narrows the permission.
        permission: "report:view",
      },
    ],
  },
  {
    label: "Workspace",
    items: [
      {
        label: "Clients",
        icon: "clients",
        href: "/clients",
        permission: "client:view",
      },
      {
        label: "Tasks",
        icon: "tasks",
        href: "/tasks",
        permission: "task:view",
      },
      {
        label: "Issues",
        icon: "issues",
        href: "/issues",
        permission: "issue:view",
      },
      {
        label: "Requests",
        icon: "requests",
        href: "/requests",
        permission: "request:view",
      },
      { label: "Team", icon: "team", phase: 9, permission: "member:view" },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        label: "Monthly Close",
        icon: "close",
        phase: 10,
        permission: "close:view",
      },
      {
        label: "Task Templates",
        icon: "templates",
        phase: 10,
        permission: "template:view",
      },
      {
        label: "Services",
        icon: "services",
        phase: 10,
        permission: "service:view",
      },
      {
        label: "Service Packages",
        icon: "packages",
        phase: 10,
        permission: "service:view",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        label: "Client Dashboard",
        icon: "clientDashboard",
        phase: 8,
        permission: "report:view",
      },
      {
        label: "Team Dashboard",
        icon: "team",
        phase: 9,
        permission: "report:view",
      },
      {
        label: "Management Report",
        icon: "report",
        phase: 9,
        permission: "report:view",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Activity Log",
        icon: "activity",
        phase: 11,
        permission: "activity:view",
      },
      { label: "Notifications", icon: "notifications", phase: 11 },
      {
        label: "Settings",
        icon: "settings",
        href: "/settings/organization",
        permission: "org:view",
      },
    ],
  },
];

export interface SettingsNavItem {
  label: string;
  icon: NavIconName;
  href?: Route;
  phase?: number;
  permission?: Permission;
}

/** Settings sub-navigation (master prompt §34). */
export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    label: "Organization",
    href: "/settings/organization",
    icon: "clients",
    permission: "org:view",
  },
  {
    label: "Members",
    href: "/settings/members",
    icon: "team",
    permission: "member:view",
  },
  { label: "Profile", href: "/settings/profile", icon: "profile" },
  {
    label: "Appearance",
    icon: "settings",
    phase: 12,
    permission: "branding:manage",
  },
  { label: "Notifications", icon: "notifications", phase: 11 },
];
