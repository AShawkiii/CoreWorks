"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ICONS } from "@/components/layout/nav-icons";
import type { SettingsNavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";

interface SettingsNavProps {
  items: SettingsNavItem[];
}

export function SettingsNav({ items }: SettingsNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="lg:w-52 lg:shrink-0">
      {/* Horizontal scroll on small screens rather than wrapping into a
          two-line tab strip, which reads as broken. */}
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {items.map((item) => {
          const Icon = NAV_ICONS[item.icon];

          if (!item.href) {
            return (
              <li key={item.label}>
                <span
                  className="flex cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground/60"
                  title={`Available in Phase ${item.phase}`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {item.label}
                  <span className="rounded border border-border px-1 text-[10px] tabular-nums">
                    P{item.phase}
                  </span>
                </span>
              </li>
            );
          }

          const active = pathname === item.href;

          return (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
