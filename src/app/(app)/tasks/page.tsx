import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { taskListQuerySchema } from "@/lib/validation/task";
import { hasPermission } from "@/server/auth/permissions";
import {
  getTaskFormOptions,
  listTasks,
  TASKS_PAGE_SIZE,
} from "@/server/services/task-queries";
import { getOrgContext } from "@/server/tenancy";

import { TaskFilters } from "./task-filters";
import { TaskTable } from "./task-table";

export const metadata: Metadata = {
  title: "Tasks",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TasksPage({ searchParams }: PageProps) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "task:view")) notFound();

  const raw = await searchParams;
  const parsed = taskListQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : taskListQuerySchema.parse({});

  // Default view is open work — a list dominated by completed history is not
  // what anyone opens this page for.
  const effective = { ...query, status: query.status ?? ("OPEN" as const) };

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    listTasks(ctx, effective),
    getTaskFormOptions(ctx),
  ]);

  const buildPageHref = (target: number) => {
    const q: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) q[key] = value;
    }
    q.page = String(target);
    return { pathname: "/tasks" as const, query: q };
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Tasks"
        description={`${total} ${total === 1 ? "task" : "tasks"} matching your filters.`}
        actions={
          hasPermission(ctx.role, "task:create") ? (
            <Link href="/tasks/new" className={buttonVariants()}>
              <Plus aria-hidden="true" />
              New task
            </Link>
          ) : null
        }
      />

      <TaskFilters
        clients={options.clients}
        members={options.members}
        periods={options.periods}
      />

      <Card className="overflow-hidden">
        <TaskTable
          rows={rows}
          members={options.members}
          canBulkEdit={hasPermission(ctx.role, "task:update")}
        />
      </Card>

      {pageCount > 1 ? (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <p className="text-muted-foreground">
            Page {page} of {pageCount} · {TASKS_PAGE_SIZE} per page
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
