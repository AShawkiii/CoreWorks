"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { EntityType } from "@/generated/prisma/enums";

const ENTITY_LABELS: Record<EntityType, string> = {
  CLIENT: "Client",
  USER: "User",
  TASK: "Task",
  TASK_TEMPLATE: "Task template",
  CLIENT_REQUEST: "Client request",
  ISSUE: "Issue",
  MONTHLY_CLOSE: "Monthly close",
  SERVICE: "Service",
  SERVICE_PACKAGE: "Service package",
  ORGANIZATION: "Organization",
  SYSTEM: "System",
};

/**
 * URL-backed filters, so an investigation is shareable — "here is the link to
 * everything that touched this client last week" — and the server does the
 * work.
 *
 * The search box submits on Enter rather than on each keystroke. Every change
 * here is a server round trip over a table that grows without bound, and a
 * per-keystroke query would run one for every letter typed.
 */
export function ActivityFilters({
  clients,
  users,
  actions,
  hasSystemEntries,
}: {
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
  actions: string[];
  hasSystemEntries: boolean;
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
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-activity-q">Search</Label>
        <Input
          id="filter-activity-q"
          type="search"
          defaultValue={params.get("q") ?? ""}
          placeholder="Action, value, client, or entry id"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setParam("q", event.currentTarget.value.trim());
            }
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-activity-client">Client</Label>
        <Select
          id="filter-activity-client"
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
        <Label htmlFor="filter-activity-user">Who</Label>
        <Select
          id="filter-activity-user"
          value={params.get("userId") ?? "ALL"}
          onChange={(event) => setParam("userId", event.target.value)}
        >
          <option value="ALL">Anyone</option>
          {/* Only offered once a scheduled run has actually written something,
              so the option never selects an empty set. */}
          {hasSystemEntries ? (
            <option value="SYSTEM">Scheduled jobs</option>
          ) : null}
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-activity-entity">Record type</Label>
        <Select
          id="filter-activity-entity"
          value={params.get("entityType") ?? "ALL"}
          onChange={(event) => setParam("entityType", event.target.value)}
        >
          <option value="ALL">All record types</option>
          {Object.values(EntityType).map((entity) => (
            <option key={entity} value={entity}>
              {ENTITY_LABELS[entity]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="filter-activity-action">Action</Label>
        <Select
          id="filter-activity-action"
          value={params.get("action") ?? "ALL"}
          onChange={(event) => setParam("action", event.target.value)}
        >
          <option value="ALL">All actions</option>
          {actions.map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-activity-from">From</Label>
          <Input
            id="filter-activity-from"
            type="date"
            defaultValue={params.get("from") ?? ""}
            onChange={(event) => setParam("from", event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-activity-to">To</Label>
          <Input
            id="filter-activity-to"
            type="date"
            defaultValue={params.get("to") ?? ""}
            onChange={(event) => setParam("to", event.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
