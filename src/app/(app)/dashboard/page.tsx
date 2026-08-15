import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HealthBadge } from "@/components/dashboard/health-badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import type { IssueSeverity } from "@/lib/domain/enums";
import { ISSUE_SEVERITY_LABELS, ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { hasPermission } from "@/server/auth/permissions";
import { getControlCenterViewModel } from "@/server/services/dashboard";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Control Center",
};

/**
 * Control Center (master prompt §16/§17, audit §8.2/§8.3).
 *
 * Every number here comes from the ported legacy view model
 * (`buildControlCenterViewModel`) — the same fourteen KPIs, the same
 * Active-only health table, the same surfacing rule for issues. Nothing is
 * recomputed in this component; it renders a server-derived view model
 * (Phase 3 requirement).
 *
 * Phase 7 adds the drill-downs: each KPI links to the list holding exactly the
 * records it counts, and every client and issue links to its own page. The
 * numbers themselves are unchanged.
 */
export default async function ControlCenterPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "report:view")) notFound();

  const viewModel = await getControlCenterViewModel(ctx);

  const canViewClients = hasPermission(ctx.role, "client:view");
  const canViewIssues = hasPermission(ctx.role, "issue:view");

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const stampFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
            <KpiCard key={kpi.key} kpi={kpi} role={ctx.role} />
          ))}
        </div>

        {/*
          Overall Completion % is a plain mean of per-client percentages, not a
          task-weighted global figure — a three-task client and a
          three-hundred-task client count the same. That is legacy's modelling
          choice, preserved rather than quietly "improved" because changing it
          would move a number management already tracks. Audit §8.2 flags it
          for product review, so the page says so rather than leaving the
          caveat buried in a code comment.
        */}
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Overall Completion % is the average of each client&rsquo;s weighted
            completion, so every client counts equally regardless of how much
            work they carry. Task counts cover all clients, including
            Onboarding and On Hold.
          </span>
        </p>
      </section>

      <section aria-labelledby="health-heading" className="mt-8">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle id="health-heading">Client health</CardTitle>
              <CardDescription>
                Active clients, most urgent first. Onboarding and On Hold
                clients appear in the cards above.
              </CardDescription>
            </div>
            {canViewClients ? (
              <Link
                href={{ pathname: "/clients", query: { status: "ACTIVE" } }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                All clients
              </Link>
            ) : null}
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
                      {canViewClients ? (
                        <Link
                          href={`/clients/${row.clientId}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.clientName}
                        </Link>
                      ) : (
                        <span className="font-medium">{row.clientName}</span>
                      )}
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
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle id="issues-heading">
                Issues requiring attention
              </CardTitle>
              <CardDescription>
                Unresolved Critical and High issues, plus anything past its
                deadline. Most severe first, then longest open.
              </CardDescription>
            </div>
            {canViewIssues ? (
              <Link
                href={{
                  pathname: "/issues",
                  query: { status: "ALL", surfaced: "true" },
                }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open in Issues
              </Link>
            ) : null}
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
                      {canViewClients ? (
                        <Link
                          href={`/clients/${issue.clientId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {issue.clientName}
                        </Link>
                      ) : (
                        issue.clientName
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {canViewIssues ? (
                        <Link
                          href={`/issues/${issue.issueId}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {issue.title}
                        </Link>
                      ) : (
                        issue.title
                      )}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {issue.issueDisplayId}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={severityVariant(issue.severity)}>
                        {ISSUE_SEVERITY_LABELS[issue.severity as IssueSeverity]}
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

      <p className="mt-6 text-xs text-muted-foreground">
        Figures as at {stampFormatter.format(viewModel.generatedAt)}. Every
        number is derived live from the current data — nothing on this page is
        cached or stored.
      </p>
    </div>
  );
}
