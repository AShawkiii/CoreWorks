"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { CloseStatus } from "@/generated/prisma/enums";
import { CLOSE_STATUS_LABELS } from "@/lib/domain/labels";

/** URL-backed filters, so a view is shareable and the server does the work. */
export function CloseFilters({
  clients,
  periods,
}: {
  clients: { id: string; name: string }[];
  periods: string[];
}) {
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
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-close-period">Period</Label>
        <Select
          id="filter-close-period"
          value={params.get("period") ?? "ALL"}
          onChange={(event) => setParam("period", event.target.value)}
        >
          <option value="ALL">All periods</option>
          {periods.map((period) => (
            <option key={period} value={period}>
              {period}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-close-client">Client</Label>
        <Select
          id="filter-close-client"
          value={params.get("clientId") ?? "ALL"}
          onChange={(event) => setParam("clientId", event.target.value)}
        >
          <option value="ALL">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-close-status">Status</Label>
        <Select
          id="filter-close-status"
          value={params.get("status") ?? "ALL"}
          onChange={(event) => setParam("status", event.target.value)}
        >
          <option value="ALL">All statuses</option>
          <option value="OPEN">Not yet closed</option>
          {Object.values(CloseStatus).map((status) => (
            <option key={status} value={status}>
              {CLOSE_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
