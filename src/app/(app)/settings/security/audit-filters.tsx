"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { auditActionLabel } from "@/lib/domain/audit-actions";

/** URL-backed, so a filtered view of an incident is shareable. */
export function AuditFilters({ actions }: { actions: string[] }) {
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
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-q">Search</Label>
        <Input
          id="audit-q"
          type="search"
          defaultValue={params.get("q") ?? ""}
          placeholder="Email, event, or address"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setParam("q", event.currentTarget.value.trim());
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-action">Event</Label>
        <Select
          id="audit-action"
          value={params.get("action") ?? "ALL"}
          onChange={(event) => setParam("action", event.target.value)}
        >
          <option value="ALL">All events</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {auditActionLabel(action)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
