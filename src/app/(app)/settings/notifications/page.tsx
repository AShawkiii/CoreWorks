import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/domain/notification";
import { NotificationType } from "@/generated/prisma/enums";
import {
  countUnreadNotifications,
  getNotificationPreferences,
} from "@/server/services/notifications";
import { getOrgContext } from "@/server/tenancy";

import { NotificationPreferencesForm } from "./preferences-form";

export const metadata: Metadata = {
  title: "Notification settings",
};

export default async function NotificationSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const [preferences, unread] = await Promise.all([
    getNotificationPreferences(ctx),
    countUnreadNotifications(ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Notify me when</CardTitle>
          <CardDescription>
            These are your own settings in {ctx.organizationSlug}. Turning
            something off stops it being created, so a muted notification does
            not appear later — it is never written at all.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesForm preferences={preferences} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery</CardTitle>
          <CardDescription>
            Notifications are delivered in the app only.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            CoreWorks has no mail transport, so there are no email or push
            options here. Offering a switch for a channel that does not exist
            would be a setting that silently does nothing.
          </p>
          <p>
            &ldquo;{NOTIFICATION_TYPE_LABELS[NotificationType.SYSTEM]}&rdquo;
            cannot be switched off. It carries the outcome of scheduled runs,
            which the people who receive it are accountable for checking.
          </p>
          <div>
            <Link
              href="/notifications"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {unread > 0 ? `View ${unread} unread` : "View notifications"}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
