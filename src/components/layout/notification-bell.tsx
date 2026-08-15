import { Bell } from "lucide-react";
import Link from "next/link";

/**
 * Header link to the notification feed, with an unread count.
 *
 * A Server Component with the count passed in, not a client poller. The number
 * is read once per render on the server, alongside everything else the shell
 * needs; polling would put a request per user per interval against a table
 * that is only interesting when something else has already changed the page.
 *
 * The count is capped at "9+" so the badge cannot grow wide enough to shift
 * the header layout.
 */
export function NotificationBell({ unread }: { unread: number }) {
  const label =
    unread === 0
      ? "Notifications"
      : `Notifications, ${unread} unread`;

  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Bell className="size-[18px]" aria-hidden="true" />
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-4 text-white tabular-nums"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
