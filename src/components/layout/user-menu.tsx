import Link from "next/link";

import { Button } from "@/components/ui/button";
import { signOutAction } from "@/server/actions/session";

interface UserMenuProps {
  name: string;
  roleLabel: string;
}

/** Initials fallback — avoids shipping an avatar service dependency. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu({ name, roleLabel }: UserMenuProps) {
  return (
    <div className="flex items-center gap-3">
      <Link
        href="/settings/profile"
        className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted"
      >
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
        >
          {initials(name)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-[11px] text-muted-foreground">
            {roleLabel}
          </span>
        </span>
      </Link>

      <form action={signOutAction}>
        <Button variant="outline" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </div>
  );
}
