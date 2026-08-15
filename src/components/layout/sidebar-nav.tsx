"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ICONS } from "@/components/layout/nav-icons";
import type { NavSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface SidebarNavProps {
  sections: NavSection[];
  onNavigate?: () => void;
}

export function SidebarNav({ sections, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3 py-4">
      {sections.map((section, index) => (
        <div key={section.label ?? `section-${index}`}>
          {section.label ? (
            <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-sidebar-muted">
              {section.label}
            </p>
          ) : null}

          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];

              if (!item.href) {
                return (
                  <li key={item.label}>
                    <span
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-muted/70"
                      title={`Available in Phase ${item.phase}`}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                      <span className="ml-auto shrink-0 rounded border border-sidebar-border px-1 text-[10px] tabular-nums">
                        P{item.phase}
                      </span>
                    </span>
                  </li>
                );
              }

              // "/settings/organization" should keep Settings highlighted on
              // every settings sub-page, so match the section prefix.
              const base = item.href.split("/").slice(0, 2).join("/");
              const active =
                pathname === item.href || pathname.startsWith(`${base}/`);

              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                        : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
