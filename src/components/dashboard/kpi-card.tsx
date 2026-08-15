import { cn } from "@/lib/utils";
import type { Kpi } from "@/lib/domain/view-models/control-center";

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

export function KpiCard({ kpi }: { kpi: Kpi }) {
  // A zero problem-count is good news, so it stays neutral — colouring it red
  // would train people to ignore the colour.
  const isProblem = kpi.value > 0;
  const critical = isProblem && CRITICAL_KEYS.has(kpi.key);
  const attention = isProblem && ATTENTION_KEYS.has(kpi.key);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
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
    </div>
  );
}
