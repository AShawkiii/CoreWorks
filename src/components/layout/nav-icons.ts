import {
  Activity,
  Bell,
  Building2,
  CalendarCheck,
  ClipboardList,
  Database,
  FileBarChart,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  ListChecks,
  MessageSquareWarning,
  Package,
  Settings,
  ShieldCheck,
  UserCircle,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { NavIconName } from "@/lib/navigation";

/**
 * Resolves a navigation icon name to its component.
 *
 * Lives on the client side of the boundary on purpose: icons are React
 * components, and functions cannot cross from a Server Component to a Client
 * Component. Navigation data therefore carries a name, and the lookup happens
 * here, after the boundary.
 */
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  clients: Building2,
  tasks: ListChecks,
  issues: MessageSquareWarning,
  requests: ClipboardList,
  team: Users,
  close: CalendarCheck,
  templates: FolderKanban,
  services: Wrench,
  packages: Package,
  clientDashboard: Gauge,
  report: FileBarChart,
  activity: Activity,
  notifications: Bell,
  settings: Settings,
  data: Database,
  shield: ShieldCheck,
  profile: UserCircle,
};
