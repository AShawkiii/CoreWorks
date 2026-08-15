"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Priority, RequestStatus } from "@/generated/prisma/enums";
import { PRIORITY_LABELS, REQUEST_STATUS_LABELS } from "@/lib/domain/labels";

interface RequestFiltersProps {
  clients: { id: string; name: string }[];
  members: { id: string; name: string }[];
  staleDays: number;
}

/** URL-backed filters, so a view is shareable and the server does the work. */
export function RequestFilters({
  clients,
  members,
  staleDays,
}: RequestFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function push(next: URLSearchParams) {
    next.delete("page");
    router.push(`${pathname}?${next.toString()}` as Route);
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "ALL") next.delete(key);
    else next.set(key, value);
    push(next);
  }

  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      push(next);
    }, 300);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor="request-search">Search</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="request-search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Request, ID, client…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-request-status">Status</Label>
        <Select
          id="filter-request-status"
          value={params.get("status") ?? "OPEN"}
          onChange={(event) => setParam("status", event.target.value)}
        >
          <option value="OPEN">Outstanding (any)</option>
          <option value="ALL">All statuses</option>
          {Object.values(RequestStatus).map((status) => (
            <option key={status} value={status}>
              {REQUEST_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-request-priority">Priority</Label>
        <Select
          id="filter-request-priority"
          value={params.get("priority") ?? "ALL"}
          onChange={(event) => setParam("priority", event.target.value)}
        >
          <option value="ALL">All priorities</option>
          {Object.values(Priority).map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-request-client">Client</Label>
        <Select
          id="filter-request-client"
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
        <Label htmlFor="filter-request-assignee">Assigned to</Label>
        <Select
          id="filter-request-assignee"
          value={params.get("assignedToId") ?? "ALL"}
          onChange={(event) => setParam("assignedToId", event.target.value)}
        >
          <option value="ALL">Everyone</option>
          <option value="UNASSIGNED">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-request-sort">Sort by</Label>
        <Select
          id="filter-request-sort"
          value={params.get("sort") ?? "waiting"}
          onChange={(event) => setParam("sort", event.target.value)}
        >
          <option value="waiting">Longest waiting</option>
          <option value="requested">Newest requested</option>
          <option value="requiredBy">Required by</option>
          <option value="priority">Priority</option>
          <option value="client">Client</option>
          <option value="status">Status</option>
        </Select>
      </div>

      <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={params.get("stale") === "true"}
          onChange={(event) =>
            setParam("stale", event.target.checked ? "true" : "")
          }
        />
        Stale only ({staleDays}+ days)
      </label>
    </div>
  );
}
