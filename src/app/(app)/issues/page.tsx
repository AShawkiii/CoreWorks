import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { issueListQuerySchema } from "@/lib/validation/issue";
import { hasPermission } from "@/server/auth/permissions";
import {
  ISSUES_PAGE_SIZE,
  getIssueFormOptions,
  listIssues,
} from "@/server/services/issue-queries";
import { getOrgContext } from "@/server/tenancy";

import { IssueFilters } from "./issue-filters";
import { IssueTable } from "./issue-table";

export const metadata: Metadata = {
  title: "Issues",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IssuesPage({ searchParams }: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "issue:view")) notFound();

  const raw = await searchParams;
  const parsed = issueListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : issueListQuerySchema.parse({});

  // Default view is unresolved work — a list dominated by resolved history is
  // not what anyone opens this page for.
  const effective = { ...query, status: query.status ?? ("OPEN" as const) };

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    listIssues(ctx, effective),
    getIssueFormOptions(ctx),
  ]);

  const buildPageHref = (target: number) => {
    const q: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) q[key] = value;
    }
    q.page = String(target);
    return { pathname: "/issues" as const, query: q };
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Issues"
        description={`${total} ${total === 1 ? "issue" : "issues"} matching your filters.`}
        actions={
          hasPermission(ctx.role, "issue:create") ? (
            <Link href="/issues/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              Raise issue
            </Link>
          ) : null
        }
      />

      <IssueFilters clients={options.clients} members={options.members} />

      <Card className="overflow-hidden">
        <IssueTable rows={rows} />
      </Card>

      {pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <p className="text-muted-foreground">
            Page {page} of {pageCount} · {ISSUES_PAGE_SIZE} per page
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
