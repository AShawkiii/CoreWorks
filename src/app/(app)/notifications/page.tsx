import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/domain/notification";
import { notificationListQuerySchema } from "@/lib/validation/notification";
import {
  markAllNotificationsReadAction,
  setNotificationReadAction,
} from "@/server/actions/notifications";
import {
  NOTIFICATIONS_PAGE_SIZE,
  listNotifications,
} from "@/server/services/notifications";
import { getOrgContext } from "@/server/tenancy";

import { NotificationFilters } from "./notification-filters";

export const metadata: Metadata = {
  title: "Notifications",
};

/**
 * A person's own notifications.
 *
 * There is no permission gate here, and that is the design: notifications are
 * addressed to a user id, the service scopes every query by it, and no role
 * grants sight of anyone else's. Gating on a permission would only be able to
 * deny someone their own.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const raw = await searchParams;
  const parsed = notificationListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : notificationListQuerySchema.parse({});

  // A refusal from a plain-form action arrives as ?error=, the same way the
  // task status actions carry one back (Phase 5) — Next redacts a thrown
  // reason in production, so the message has to travel in the URL.
  const refusal = typeof raw.error === "string" ? raw.error : null;

  const { rows, total, unread, page, pageCount } = await listNotifications(
    ctx,
    query,
  );

  const buildPageHref = (target: number) => {
    const q: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) q[key] = value;
    }
    q.page = String(target);
    return { pathname: "/notifications" as const, query: q };
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Notifications"
        description={
          unread === 0
            ? `${total} notification${total === 1 ? "" : "s"}, all read.`
            : `${unread} unread of ${total}.`
        }
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/settings/notifications"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Settings
            </Link>
            {unread > 0 ? (
              <form action={markAllNotificationsReadAction}>
                <Button type="submit" size="sm" variant="outline">
                  Mark all read
                </Button>
              </form>
            ) : null}
          </div>
        }
      />

      <FormMessage status="error" message={refusal ?? undefined} />

      <NotificationFilters />

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">Nothing here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You are notified when work is assigned to you, when a deadline
              approaches, and when a client you own changes health.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className={
                  row.read
                    ? "flex flex-wrap items-start gap-3 px-4 py-4 sm:px-6"
                    : "flex flex-wrap items-start gap-3 bg-surface px-4 py-4 sm:px-6"
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.read ? null : (
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full bg-primary"
                      />
                    )}
                    <Badge variant="neutral">
                      {NOTIFICATION_TYPE_LABELS[row.type]}
                    </Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                    {row.read ? null : (
                      <span className="sr-only">Unread</span>
                    )}
                  </div>

                  <p className="mt-1 text-sm font-medium">
                    {row.href ? (
                      <Link
                        href={row.href as Route}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.title}
                      </Link>
                    ) : (
                      row.title
                    )}
                  </p>

                  {row.body ? (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {row.body}
                    </p>
                  ) : null}
                </div>

                {/* Read is reversible, so a misclick costs nothing. */}
                <form action={setNotificationReadAction} className="shrink-0">
                  <input
                    type="hidden"
                    name="notificationId"
                    value={row.id}
                  />
                  <input
                    type="hidden"
                    name="read"
                    value={row.read ? "false" : "true"}
                  />
                  <Button type="submit" size="sm" variant="ghost">
                    {row.read ? "Mark unread" : "Mark read"}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <p className="text-muted-foreground">
            Page {page} of {pageCount} · {NOTIFICATIONS_PAGE_SIZE} per page
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildPageHref(page - 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Previous
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={buildPageHref(page + 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
