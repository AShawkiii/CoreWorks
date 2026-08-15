"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Priority, TaskStatus } from "@/generated/prisma/enums";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/domain/labels";

interface TaskFiltersProps {
  clients: { id: string; name: string }[];
  members: { id: string; name: string }[];
  periods: string[];
}

/** URL-backed filters, so a view is shareable and the server does the work. */
export function TaskFilters({ clients, members, periods }: TaskFiltersProps) {
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
        <Label htmlFor="task-search">Search</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="task-search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Task, ID, service area, client…"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-task-status">Status</Label>
        <Select
          id="filter-task-status"
          value={params.get("status") ?? "OPEN"}
          onChange={(event) => setParam("status", event.target.value)}
        >
          <option value="OPEN">Open (any)</option>
          <option value="ALL">All statuses</option>
          {Object.values(TaskStatus).map((status) => (
            <option key={status} value={status}>
              {TASK_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-task-priority">Priority</Label>
        <Select
          id="filter-task-priority"
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
        <Label htmlFor="filter-task-client">Client</Label>
        <Select
          id="filter-task-client"
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
        <Label htmlFor="filter-task-assignee">Assigned to</Label>
        <Select
          id="filter-task-assignee"
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
        <Label htmlFor="filter-task-period">Period</Label>
        <Select
          id="filter-task-period"
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
        <Label htmlFor="filter-task-sort">Sort by</Label>
        <Select
          id="filter-task-sort"
          value={params.get("sort") ?? "dueDate"}
          onChange={(event) => setParam("sort", event.target.value)}
        >
          <option value="dueDate">Due date</option>
          <option value="priority">Priority</option>
          <option value="client">Client</option>
          <option value="status">Status</option>
          <option value="created">Newest</option>
        </Select>
      </div>

      <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={params.get("overdue") === "true"}
          onChange={(event) =>
            setParam("overdue", event.target.checked ? "true" : "")
          }
        />
        Overdue only
      </label>
    </div>
  );
}
