"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { NotificationType } from "@/generated/prisma/enums";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/domain/notification";

export function NotificationFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "ALL") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}` as Route);
  }

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-notification-read">Show</Label>
        <Select
          id="filter-notification-read"
          value={params.get("unread") === "true" ? "true" : "ALL"}
          onChange={(event) =>
            // Written as the literal "true"/absent rather than "false": the
            // query schema reads the token explicitly, and an emitted
            // `?unread=false` would be a value the reader has to special-case.
            setParam("unread", event.target.value === "true" ? "true" : "")
          }
        >
          <option value="ALL">Everything</option>
          <option value="true">Unread only</option>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-notification-type">Type</Label>
        <Select
          id="filter-notification-type"
          value={params.get("type") ?? "ALL"}
          onChange={(event) => setParam("type", event.target.value)}
        >
          <option value="ALL">All types</option>
          {Object.values(NotificationType).map((type) => (
            <option key={type} value={type}>
              {NOTIFICATION_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
