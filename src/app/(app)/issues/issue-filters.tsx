"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { IssueSeverity, IssueStatus } from "@/generated/prisma/enums";
import {
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
} from "@/lib/domain/labels";

interface IssueFiltersProps {
  clients: { id: string; name: string }[];
  members: { id: string; name: string }[];
}

/** URL-backed filters, so a view is shareable and the server does the work. */
export function IssueFilters({ clients, members }: IssueFiltersProps) {
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
        <Label htmlFor="issue-search">Search</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="issue-search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Issue, ID, category, client…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-issue-status">Status</Label>
        <Select
          id="filter-issue-status"
          value={params.get("status") ?? "OPEN"}
          onChange={(event) => setParam("status", event.target.value)}
        >
          <option value="OPEN">Open (any)</option>
          <option value="ALL">All statuses</option>
          {Object.values(IssueStatus).map((status) => (
            <option key={status} value={status}>
              {ISSUE_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-issue-severity">Severity</Label>
        <Select
          id="filter-issue-severity"
          value={params.get("severity") ?? "ALL"}
          onChange={(event) => setParam("severity", event.target.value)}
        >
          <option value="ALL">All severities</option>
          {Object.values(IssueSeverity).map((severity) => (
            <option key={severity} value={severity}>
              {ISSUE_SEVERITY_LABELS[severity]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-issue-client">Client</Label>
        <Select
          id="filter-issue-client"
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
        <Label htmlFor="filter-issue-assignee">Assigned to</Label>
        <Select
          id="filter-issue-assignee"
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
        <Label htmlFor="filter-issue-sort">Sort by</Label>
        <Select
          id="filter-issue-sort"
          value={params.get("sort") ?? "severity"}
          onChange={(event) => setParam("sort", event.target.value)}
        >
          <option value="severity">Severity, then oldest</option>
          <option value="raised">Newest raised</option>
          <option value="deadline">Deadline</option>
          <option value="client">Client</option>
          <option value="status">Status</option>
        </Select>
      </div>

      <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={params.get("surfaced") === "true"}
          onChange={(event) =>
            setParam("surfaced", event.target.checked ? "true" : "")
          }
        />
        Needing attention only
      </label>
    </div>
  );
}
