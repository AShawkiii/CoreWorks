"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ContractStatus } from "@/generated/prisma/enums";
import {
  CLIENT_HEALTH_LABELS,
  CONTRACT_STATUS_LABELS,
} from "@/lib/domain/labels";

interface ClientFiltersProps {
  managers: { id: string; name: string }[];
}

const HEALTHS = ["ON_TRACK", "AT_RISK", "DELAYED", "ON_HOLD"] as const;

/**
 * Filter bar.
 *
 * State lives in the URL, not component state, so a filtered view is
 * shareable and survives a refresh — and so the server does the filtering
 * (master prompt §47) rather than the browser.
 */
export function ClientFilters({ managers }: ClientFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function push(next: URLSearchParams) {
    // Any filter change returns to page 1; staying on page 7 of a narrower
    // result set would show an empty screen.
    next.delete("page");
    // Built at runtime from user input, so typed routes cannot narrow it.
    router.push(`${pathname}?${next.toString()}` as Route);
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "ALL") next.delete(key);
    else next.set(key, value);
    push(next);
  }

  // Debounced so typing does not fire a request per keystroke.
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
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor="client-search">Search</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="client-search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Name, company, ID, industry…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-status">Status</Label>
        <Select
          id="filter-status"
          value={params.get("status") ?? "ALL"}
          onChange={(event) => setParam("status", event.target.value)}
        >
          <option value="ALL">All statuses</option>
          {Object.values(ContractStatus).map((status) => (
            <option key={status} value={status}>
              {CONTRACT_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-health">Health</Label>
        <Select
          id="filter-health"
          value={params.get("health") ?? "ALL"}
          onChange={(event) => setParam("health", event.target.value)}
        >
          <option value="ALL">All health</option>
          {HEALTHS.map((health) => (
            <option key={health} value={health}>
              {CLIENT_HEALTH_LABELS[health]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-sort">Sort by</Label>
        <Select
          id="filter-sort"
          value={params.get("sort") ?? "health"}
          onChange={(event) => setParam("sort", event.target.value)}
        >
          <option value="health">Most urgent</option>
          <option value="name">Name</option>
          <option value="completion">Lowest completion</option>
          <option value="nextDeadline">Next deadline</option>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5 lg:col-span-2">
        <Label htmlFor="filter-manager">Account manager</Label>
        <Select
          id="filter-manager"
          value={params.get("accountManagerId") ?? "ALL"}
          onChange={(event) => setParam("accountManagerId", event.target.value)}
        >
          <option value="ALL">Everyone</option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.name}
            </option>
          ))}
        </Select>
      </div>

      <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={params.get("includeArchived") === "true"}
          onChange={(event) =>
            setParam("includeArchived", event.target.checked ? "true" : "")
          }
        />
        Include archived
      </label>
    </div>
  );
}
