"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import type { NavSection } from "@/lib/navigation";

interface AppShellProps {
  sections: NavSection[];
  organizationName: string;
  logoUrl: string | null;
  userMenu: React.ReactNode;
  /**
   * Rendered on the server and passed through as a node, like `userMenu`. The
   * shell is a Client Component and must not query anything itself.
   */
  notifications: React.ReactNode;
  /** Server-resolved light/dark mode, so the toggle renders correct on first paint. */
  themeMode: "light" | "dark" | "system";
  children: React.ReactNode;
}

/**
 * Application shell: fixed sidebar on desktop, drawer on mobile
 * (master prompt §31/§60).
 */
export function AppShell({
  sections,
  organizationName,
  logoUrl,
  userMenu,
  notifications,
  themeMode,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape closes the drawer — expected of any modal overlay (§61).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Stop the page scrolling behind the open drawer.
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const sidebarContent = (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <Logo
          logoUrl={logoUrl}
          name={organizationName}
          className="text-sidebar-foreground"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav
          sections={sections}
          onNavigate={() => setDrawerOpen(false)}
        />
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        {sidebarContent}
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="relative flex h-full w-64 flex-col bg-sidebar shadow-xl"
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-2 top-2 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <X aria-hidden="true" />
              <span className="sr-only">Close navigation</span>
            </Button>
            {sidebarContent}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
          >
            <Menu aria-hidden="true" />
            <span className="sr-only">Open navigation</span>
          </Button>

          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            {notifications}
            <ThemeToggle initialMode={themeMode} />
            {userMenu}
          </div>
        </header>

        <main className="flex-1 bg-surface">{children}</main>
      </div>
    </div>
  );
}
