import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HealthBadge } from "@/components/dashboard/health-badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ISSUE_SEVERITY_LABELS, ORG_ROLE_LABELS } from "@/lib/domain/labels";
import type { IssueSeverity } from "@/lib/domain/enums";
import { getControlCenterViewModel } from "@/server/services/dashboard";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Control Center",
};

/**
 * Control Center.
 *
 * Every number here comes from the ported legacy view model
 * (`buildControlCenterViewModel`) — the same fourteen KPIs, the same
 * Active-only health table, the same surfacing rule for issues. Nothing is
 * recomputed in this component; it renders a server-derived view model
 * (Phase 3 requirement).
 */
export default async function ControlCenterPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  const viewModel = await getControlCenterViewModel(ctx);

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const formatDate = (date: Date | null) =>
    date ? dateFormatter.format(date) : "—";

  const severityVariant = (severity: string) =>
    severity === "CRITICAL"
      ? "danger"
      : severity === "HIGH"
        ? "warning"
        : "neutral";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Control Center"
        description={`Every client, task, and risk in one place — signed in as ${ORG_ROLE_LABELS[ctx.role]}.`}
      />

      <section aria-labelledby="kpis-heading">
        <h2 id="kpis-heading" className="sr-only">
          Key performance indicators
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {viewModel.kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      </section>

      <section aria-labelledby="health-heading" className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle id="health-heading">Client health</CardTitle>
            <CardDescription>
              Active clients, most urgent first. Onboarding and On Hold clients
              appear in the cards above.
            </CardDescription>
          </CardHeader>

          {viewModel.clientHealth.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No active clients yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Service package</TableHead>
                  <TableHead>Account manager</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Completion</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                  <TableHead>Next deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewModel.clientHealth.map((row) => (
                  <TableRow key={row.clientId}>
                    <TableCell>
                      <span className="font-medium">{row.clientName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.clientDisplayId}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.servicePackage ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.accountManager ?? "—"}
                    </TableCell>
                    <TableCell>
                      <HealthBadge health={row.health} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(row.completionPct * 100)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.overdueTasks > 0 ? (
                        <span className="font-medium text-danger">
                          {row.overdueTasks}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.waitingOnClient}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.openIssues}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(row.nextDeadline)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      <section aria-labelledby="issues-heading" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle id="issues-heading">Issues requiring attention</CardTitle>
            <CardDescription>
              Unresolved Critical and High issues, plus anything past its
              deadline. Most severe first, then longest open.
            </CardDescription>
          </CardHeader>

          {viewModel.surfacedIssues.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Nothing needs attention right now.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Days open</TableHead>
                  <TableHead>Deadline</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewModel.surfacedIssues.map((issue) => (
                  <TableRow key={issue.issueId}>
                    <TableCell className="text-muted-foreground">
                      {issue.clientName}
                    </TableCell>
                    <TableCell className="font-medium">{issue.title}</TableCell>
                    <TableCell>
                      <Badge variant={severityVariant(issue.severity)}>
                        {
                          ISSUE_SEVERITY_LABELS[
                            issue.severity as IssueSeverity
                          ]
                        }
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {issue.owner ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {issue.daysOpen ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(issue.deadline)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  );
}
