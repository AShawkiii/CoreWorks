"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * The client selector.
 *
 * Legacy's Client Dashboard was a sheet with a picker cell whose `onEdit`
 * trigger re-rendered every section (`automation/Triggers.gs:28`). This is
 * that control: changing it sets `?clientId=` and the server re-renders, so
 * the view stays shareable as a URL rather than living in a cell.
 */
export function ClientPicker({
  clients,
  selectedId,
}: {
  clients: { id: string; name: string; displayId: string }[];
  selectedId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <div className="flex flex-col gap-1.5 sm:max-w-sm">
      <Label htmlFor="client-dashboard-picker">Select client</Label>
      <Select
        id="client-dashboard-picker"
        value={selectedId}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          if (event.target.value) next.set("clientId", event.target.value);
          else next.delete("clientId");
          router.push(`${pathname}?${next.toString()}` as Route);
        }}
      >
        <option value="">Choose a client…</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name} ({client.displayId})
          </option>
        ))}
      </Select>
    </div>
  );
}
