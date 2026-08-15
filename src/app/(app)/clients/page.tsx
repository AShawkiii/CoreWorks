import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HealthBadge } from "@/components/dashboard/health-badge";
import { ClientFilters } from "./client-filters";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONTRACT_STATUS_LABELS } from "@/lib/domain/labels";
import { clientListQuerySchema } from "@/lib/validation/client";
import { hasPermission } from "@/server/auth/permissions";
import {
  CLIENTS_PAGE_SIZE,
  getClientFormOptions,
  listClients,
} from "@/server/services/clients";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Clients",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ClientsPage({ searchParams }: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "client:view")) notFound();

  const raw = await searchParams;
  // A malformed query string falls back to defaults rather than erroring —
  // URLs get edited and shared by hand.
  const parsed = clientListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : clientListQuerySchema.parse({});

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    listClients(ctx, query),
    getClientFormOptions(ctx),
  ]);

  const dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // The object form keeps typed routes satisfied for a query built at runtime.
  const buildPageHref = (target: number) => {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) query[key] = value;
    }
    query.page = String(target);
    return { pathname: "/clients" as const, query };
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Clients"
        description={`${total} ${total === 1 ? "client" : "clients"} matching your filters.`}
        actions={
          hasPermission(ctx.role, "client:create") ? (
            <Link href="/clients/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              New client
            </Link>
          ) : null
        }
      />

      <ClientFilters managers={options.members} />

      <Card>
        {rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">No clients found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 0 && !query.q
                ? "Add your first client to start generating work."
                : "Try widening your filters."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Service package</TableHead>
                <TableHead>Account manager</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead>Next deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.clientId}>
                  <TableCell>
                    <Link
                      href={`/clients/${row.clientId}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {row.clientName}
                    </Link>
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
                    <Badge variant="outline">
                      {CONTRACT_STATUS_LABELS[row.contractStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <HealthBadge health={row.health} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Math.round(row.completionPct * 100)}%
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {row.nextDeadline
                      ? dateFormatter.format(row.nextDeadline)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <p className="text-muted-foreground">
            Page {page} of {pageCount} · {CLIENTS_PAGE_SIZE} per page
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildPageHref(page - 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Previous
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link
                href={buildPageHref(page + 1)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
