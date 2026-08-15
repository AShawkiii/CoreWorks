import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
import { formatPeriod } from "@/lib/domain/date";
import { FREQUENCY_LABELS, PRIORITY_LABELS } from "@/lib/domain/labels";
import { hasPermission } from "@/server/auth/permissions";
import { getCatalogTotals, getPackageCatalog } from "@/server/services/catalog";
import { getOrgContext } from "@/server/tenancy";

import { GenerationPanel } from "./generation-panel";

export const metadata: Metadata = {
  title: "Task Templates",
};

/**
 * Task templates (audit §6.12).
 *
 * One section per service package, because that is how legacy stored them:
 * each tier holds its own full set of rows, queried by exact package match,
 * rather than referencing a shared pool. Full Finance's sixteen therefore
 * include Basic's nine as rows of its own.
 */
export default async function TemplatesPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "template:view")) notFound();

  const [packages, totals] = await Promise.all([
    getPackageCatalog(ctx),
    getCatalogTotals(ctx),
  ]);

  const canGenerate = hasPermission(ctx.role, "template:manage");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Task Templates"
        description={`${totals.templates} template${totals.templates === 1 ? "" : "s"} across ${totals.packages} package${totals.packages === 1 ? "" : "s"}. These are what recurring work expands from.`}
        actions={
          hasPermission(ctx.role, "service:view") ? (
            <Link
              href="/service-packages"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Service packages
            </Link>
          ) : null
        }
      />

      {canGenerate ? (
        <GenerationPanel defaultPeriod={formatPeriod(new Date())} />
      ) : null}

      {packages.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No packages yet</CardTitle>
            <CardDescription>
              Templates belong to a service package.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {packages.map((pkg) => (
            <Card key={pkg.id} className="overflow-hidden">
              <CardHeader>
                <div className="flex flex-wrap items-baseline gap-2">
                  <CardTitle>{pkg.name}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {pkg.displayId}
                  </span>
                  {!pkg.isActive ? (
                    <Badge variant="neutral">Inactive</Badge>
                  ) : null}
                </div>
                <CardDescription>
                  {pkg.templates.length} template
                  {pkg.templates.length === 1 ? "" : "s"} ·{" "}
                  {pkg.clientCount} client{pkg.clientCount === 1 ? "" : "s"}
                  {pkg.description ? ` · ${pkg.description}` : ""}
                </CardDescription>
              </CardHeader>

              {pkg.templates.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  No templates on this package.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Service area</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Default assignee</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead>Client input</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pkg.templates.map((template) => (
                      <TableRow key={template.id}>
                        <TableCell className="font-medium">
                          {template.taskName}
                          {!template.isActive ? (
                            <Badge variant="neutral" className="ml-2">
                              Inactive
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {template.serviceArea}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {FREQUENCY_LABELS[template.frequency]}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {PRIORITY_LABELS[template.priority]}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {/* A ROLE, not a person — resolved per client at
                              generation time (audit §6.10). */}
                          {template.defaultAssigneeRole ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {template.typicalDurationDays}d
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {template.requiresClientInput ? "Required" : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Each package carries its own full set of templates rather than
        referencing a shared pool, so a tier&rsquo;s count is its total, not an
        increment over the tier below.
      </p>
    </div>
  );
}
