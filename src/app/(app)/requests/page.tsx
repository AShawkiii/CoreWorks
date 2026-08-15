import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requestListQuerySchema } from "@/lib/validation/request";
import { hasPermission } from "@/server/auth/permissions";
import {
  REQUESTS_PAGE_SIZE,
  getRequestFormOptions,
  listRequests,
} from "@/server/services/request-queries";
import { getOrgContext } from "@/server/tenancy";

import { RequestFilters } from "./request-filters";
import { RequestTable } from "./request-table";

export const metadata: Metadata = {
  title: "Requests",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RequestsPage({ searchParams }: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "request:view")) notFound();

  const raw = await searchParams;
  const parsed = requestListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : requestListQuerySchema.parse({});

  // Default view is outstanding work — the question this page answers is
  // "what are we still waiting on".
  const effective = { ...query, status: query.status ?? ("OPEN" as const) };

  const [{ rows, total, page, pageCount, staleDays }, options] =
    await Promise.all([
      listRequests(ctx, effective),
      getRequestFormOptions(ctx),
    ]);

  const buildPageHref = (target: number) => {
    const q: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) q[key] = value;
    }
    q.page = String(target);
    return { pathname: "/requests" as const, query: q };
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Client requests"
        description={`${total} ${total === 1 ? "request" : "requests"} matching your filters. Stale is ${staleDays}+ days waiting.`}
        actions={
          hasPermission(ctx.role, "request:create") ? (
            <Link href="/requests/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              Raise request
            </Link>
          ) : null
        }
      />

      <RequestFilters
        clients={options.clients}
        members={options.members}
        staleDays={staleDays}
      />

      <Card className="overflow-hidden">
        <RequestTable rows={rows} />
      </Card>

      {pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <p className="text-muted-foreground">
            Page {page} of {pageCount} · {REQUESTS_PAGE_SIZE} per page
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
