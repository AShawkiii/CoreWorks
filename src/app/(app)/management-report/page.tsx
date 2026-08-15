import { AlertTriangle, Ban, Clock, TrendingDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { MANAGEMENT_ATTENTION_LIMIT } from "@/lib/domain/view-models/management-report";
import type { AttentionItem } from "@/lib/domain/view-models/management-report";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/server/auth/permissions";
import { getManagementReport } from "@/server/services/dashboard";
import { getOrgSettings } from "@/server/services/settings";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Management Report",
};

const ATTENTION_ICON: Record<AttentionItem["type"], typeof AlertTriangle> = {
  "Client Delayed": TrendingDown,
  "Critical Issue": AlertTriangle,
  "Blocked Task": Ban,
  "Stale Request": Clock,
};

/**
 * Management Report (audit §8.6).
 *
 * Port of legacy `dashboards/ManagementReportLogic.gs` — the four sections in
 * the order that file builds them: Client Performance, Team Performance,
 * Operational Risks, Management Attention.
 *
 * Every figure comes from the Phase 3 port. Nothing is recomputed here.
 */
export default async function ManagementReportPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "report:view")) notFound();

  const [report, settings] = await Promise.all([
    getManagementReport(ctx),
    getOrgSettings(ctx.organizationId),
  ]);

  const canViewClients = hasPermission(ctx.role, "client:view");
  const canViewTasks = hasPermission(ctx.role, "task:view");
  const canViewIssues = hasPermission(ctx.role, "issue:view");
  const canViewRequests = hasPermission(ctx.role, "request:view");

  const { clientPerformance: cp, operationalRisks: risks } = report;
  const attention = report.managementAttention;

  const stampFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // The section is capped, so say when there is more behind it rather than
  // implying the list is everything.
  const attentionAtCap = attention.length === MANAGEMENT_ATTENTION_LIMIT;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Management Report"
        description="Where the practice stands, and what needs a decision this month."
      />

      {/* 1 — Client Performance */}
      <section aria-labelledby="clients-heading" className="mb-6">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle id="clients-heading">Client performance</CardTitle>
              <CardDescription>
                Grouped by health. On Track is ordered by weighted completion,
                best first.
              </CardDescription>
            </div>
            {canViewClients ? (
              <Link
                href={{ pathname: "/clients", query: { status: "ALL" } }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                All clients
              </Link>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ClientGroup
              label="On Track"
              names={cp.best}
              tone="success"
              href={canViewClients ? "ON_TRACK" : null}
            />
            <ClientGroup
              label="At Risk"
              names={cp.atRisk}
              tone="warning"
              href={canViewClients ? "AT_RISK" : null}
            />
            <ClientGroup
              label="Delayed"
              names={cp.delayed}
              tone="danger"
              href={canViewClients ? "DELAYED" : null}
            />
            <ClientGroup
              label="On Hold"
              names={cp.onHold}
              tone="neutral"
              href={canViewClients ? "ON_HOLD" : null}
            />
          </CardContent>
        </Card>
      </section>

      {/* 2 — Team Performance */}
      <section aria-labelledby="team-heading" className="mb-6">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle id="team-heading">Team performance</CardTitle>
              <CardDescription>
                Per member, excluding cancelled work.
              </CardDescription>
            </div>
            <Link
              href="/team-dashboard"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Team Dashboard
            </Link>
          </CardHeader>
          {report.teamPerformance.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No team members yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Tasks</TableHead>
                  <TableHead className="text-right">Completed</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">Completion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.teamPerformance.map((row) => (
                  <TableRow key={row.member}>
                    <TableCell className="font-medium">{row.member}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.tasks}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.completed}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.overdue > 0 ? (
                        <span className="font-medium text-danger">
                          {row.overdue}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Math.round(row.completionPct * 100)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>

      {/* 3 — Operational Risks */}
      <section aria-labelledby="risks-heading" className="mb-6">
        <h2 id="risks-heading" className="mb-3 text-base font-semibold">
          Operational risks
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <RiskCard
            label="Overdue tasks"
            value={risks.overdueTasks}
            href={
              canViewTasks
                ? { pathname: "/tasks", query: { status: "ALL", overdue: "true" } }
                : null
            }
          />
          <RiskCard
            label="Critical issues"
            value={risks.criticalIssues}
            href={
              canViewIssues
                ? {
                    pathname: "/issues",
                    query: { status: "OPEN", severity: "CRITICAL" },
                  }
                : null
            }
          />
          <RiskCard
            label="Blocked tasks"
            value={risks.blockedTasks}
            href={
              canViewTasks
                ? { pathname: "/tasks", query: { status: "BLOCKED" } }
                : null
            }
          />
          <RiskCard
            label="Outstanding requests"
            value={risks.outstandingRequests}
            href={
              canViewRequests
                ? { pathname: "/requests", query: { status: "OPEN" } }
                : null
            }
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Critical issues and outstanding requests count open items only.
          Overdue and blocked counts run across every task, matching the report
          this replaces.
        </p>
      </section>

      {/* 4 — Management Attention */}
      <section aria-labelledby="attention-heading">
        <Card>
          <CardHeader>
            <CardTitle id="attention-heading">Needs management attention</CardTitle>
            <CardDescription>
              Ordered by category — delayed clients first, then critical issues,
              blocked tasks, and requests stale beyond {settings.REQUEST_STALE_DAYS}{" "}
              days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing needs attention right now.
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {attention.map((item, index) => {
                  const Icon = ATTENTION_ICON[item.type];
                  return (
                    <li
                      key={`${item.type}-${item.label}-${index}`}
                      className="flex items-start gap-2.5 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          item.type === "Client Delayed" && "text-danger",
                          item.type === "Critical Issue" && "text-danger",
                          item.type === "Blocked Task" && "text-warning",
                          item.type === "Stale Request" && "text-warning",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {item.type}
                        </span>
                        <span className="block">{item.label}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {attentionAtCap ? (
              <p className="mt-4 text-xs text-muted-foreground">
                Showing the first {MANAGEMENT_ATTENTION_LIMIT} items — the cap
                the existing report uses. There may be more behind each
                category.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Figures as at {stampFormatter.format(new Date())}. Every number is
        derived live from the current data.
      </p>
    </div>
  );
}

function ClientGroup({
  label,
  names,
  tone,
  href,
}: {
  label: string;
  names: string[];
  tone: "success" | "warning" | "danger" | "neutral";
  href: string | null;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <p
          className={cn(
            "text-xs font-medium uppercase tracking-wide",
            tone === "danger" && "text-danger",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success",
            tone === "neutral" && "text-muted-foreground",
          )}
        >
          {label}
        </p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {names.length}
        </span>
      </div>
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-sm">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
      {href && names.length > 0 ? (
        <Link
          href={{ pathname: "/clients", query: { status: "ALL", health: href } }}
          className="mt-1.5 inline-block text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Open in Clients
        </Link>
      ) : null}
    </div>
  );
}

function RiskCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: { pathname: "/tasks" | "/issues" | "/requests"; query: Record<string, string> } | null;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
          value > 0 && "text-danger",
        )}
      >
        {value}
      </p>
    </>
  );

  if (!href) {
    return <div className="rounded-lg border border-border bg-card p-4">{body}</div>;
  }

  return (
    <Link
      href={href}
      aria-label={`${label}: ${value} — view the list`}
      className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {body}
    </Link>
  );
}
