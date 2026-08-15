import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
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
import {
  auditActionLabel,
  isSecurityConcern,
} from "@/lib/domain/audit-actions";
import { PASSWORD_RESET_RULE, SIGN_IN_RULE } from "@/lib/domain/rate-limit";
import { hasPermission } from "@/server/auth/permissions";
import { AUDIT_PAGE_SIZE, listAuditLog } from "@/server/services/audit-queries";
import { getOrgContext } from "@/server/tenancy";

import { AuditFilters } from "./audit-filters";

export const metadata: Metadata = {
  title: "Security",
};

function formatTimestamp(value: Date): string {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The security trail — `AuditLog`, distinct from the Activity Log.
 *
 * `settings:manage` (Owner and Admin) rather than the `activity:view` that
 * gates the business trail: this shows failed sign-ins and bulk exports across
 * the whole instance, which is an administrator's concern rather than a
 * manager's.
 */
export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "settings:manage")) notFound();

  const raw = await searchParams;
  const page = Number.parseInt(String(raw.page ?? "1"), 10);

  const result = await listAuditLog(ctx, {
    action: typeof raw.action === "string" ? raw.action : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  });

  const buildPageHref = (target: number) => {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string" && value) query[key] = value;
    }
    query.page = String(target);
    return { pathname: "/settings/security" as const, query };
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Protection in place</CardTitle>
          <CardDescription>
            What the application does without anyone configuring it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">Sign-in attempts</p>
            <p>
              {SIGN_IN_RULE.limit} per {SIGN_IN_RULE.windowMs / 60000} minutes
              per account. Further attempts are refused without checking the
              password, and every outcome is recorded below.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Password resets</p>
            <p>
              {PASSWORD_RESET_RULE.limit} per hour per account, so the reset
              form cannot be used to flood somebody&rsquo;s inbox.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Uniform failures</p>
            <p>
              An unknown address and a wrong password are indistinguishable to
              the caller, so sign-in cannot be used to discover who has an
              account. The reason is still recorded here.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Browser policy</p>
            <p>
              A per-request Content-Security-Policy nonce, framing denied, and
              strict transport security — sent on every response.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit trail</CardTitle>
          <CardDescription>
            Sign-ins and data movement. Separate from the{" "}
            <Link
              href="/activity"
              className="underline underline-offset-4"
            >
              Activity Log
            </Link>
            , which records what happened to clients and their work.
            {result.recentFailures > 0 ? (
              <>
                {" "}
                <span className="font-medium text-danger">
                  {result.recentFailures} failed sign-in
                  {result.recentFailures === 1 ? "" : "s"} in the last 24 hours.
                </span>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AuditFilters actions={result.actions} />

          {result.rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm font-medium">Nothing recorded yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign-ins and data imports or exports appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatTimestamp(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            isSecurityConcern(row.action) ? "danger" : "neutral"
                          }
                        >
                          {auditActionLabel(row.action)}
                        </Badge>
                        {row.unattributed ? (
                          <span
                            className="ml-2 text-xs text-muted-foreground"
                            title="This attempt matched no organization, so it is shown to every administrator."
                          >
                            unattributed
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.userName ?? row.userEmail ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.ipAddress ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {result.pageCount > 1 ? (
            <nav
              aria-label="Pagination"
              className="flex items-center justify-between text-sm"
            >
              <p className="text-muted-foreground">
                Page {result.page} of {result.pageCount} · {AUDIT_PAGE_SIZE} per
                page
              </p>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Link
                    href={buildPageHref(result.page - 1)}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Previous
                  </Link>
                ) : null}
                {result.page < result.pageCount ? (
                  <Link
                    href={buildPageHref(result.page + 1)}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}

          <p className="text-xs text-muted-foreground">
            A failed sign-in against an address that belongs to no organization
            cannot be attributed to one, so it is shown to every
            administrator&rsquo;s trail. That is an email address and a
            timestamp — no client data — and it is what makes an attack in
            progress visible at all.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
