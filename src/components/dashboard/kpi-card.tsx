import Link from "next/link";

import { KPI_LINKS } from "@/lib/dashboard/kpi-links";
import type { Kpi } from "@/lib/domain/view-models/control-center";
import { cn } from "@/lib/utils";
import type { OrgRole } from "@/generated/prisma/enums";
import { hasPermission } from "@/server/auth/permissions";

/** Emphasis for KPIs that represent a problem rather than a fact. */
const ATTENTION_KEYS = new Set([
  "clientsAtRisk",
  "overdueTasks",
  "blockedTasks",
  "issuesNeedingAttention",
]);
const CRITICAL_KEYS = new Set(["clientsDelayed"]);

function formatValue(kpi: Kpi): string {
  if (kpi.format === "percent") {
    return `${Math.round(kpi.value * 100)}%`;
  }
  return String(kpi.value);
}

export function KpiCard({ kpi, role }: { kpi: Kpi; role: OrgRole }) {
  // A zero problem-count is good news, so it stays neutral — colouring it red
  // would train people to ignore the colour.
  const isProblem = kpi.value > 0;
  const critical = isProblem && CRITICAL_KEYS.has(kpi.key);
  const attention = isProblem && ATTENTION_KEYS.has(kpi.key);

  const link = KPI_LINKS[kpi.key];
  // Not every KPI has a list behind it, and a viewer without permission for
  // the destination should not be offered a link they cannot follow.
  const drillable = link !== undefined && hasPermission(role, link.permission);

  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
          critical && "text-danger",
          attention && "text-warning",
        )}
      >
        {formatValue(kpi)}
      </p>
    </>
  );

  if (!drillable) {
    return <div className="rounded-lg border border-border bg-card p-4">{body}</div>;
  }

  return (
    <Link
      href={{ pathname: link.pathname, query: link.query }}
      aria-label={`${kpi.label}: ${formatValue(kpi)} — view the list`}
      className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {body}
    </Link>
  );
}
