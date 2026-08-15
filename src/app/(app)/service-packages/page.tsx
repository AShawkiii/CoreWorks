import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasPermission } from "@/server/auth/permissions";
import { getPackageCatalog } from "@/server/services/catalog";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Service Packages",
};

export default async function ServicePackagesPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "service:view")) notFound();

  const packages = await getPackageCatalog(ctx);
  const canViewTemplates = hasPermission(ctx.role, "template:view");
  const canViewClients = hasPermission(ctx.role, "client:view");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Service Packages"
        description="What each tier includes, and how much recurring work it generates."
        actions={
          canViewTemplates ? (
            <Link
              href="/templates"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Task templates
            </Link>
          ) : null
        }
      />

      {packages.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No packages yet</CardTitle>
            <CardDescription>
              Packages are seeded with the organization.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {packages.map((pkg) => {
            const areas = [
              ...new Set(pkg.templates.map((t) => t.serviceArea)),
            ].sort();

            return (
              <Card key={pkg.id}>
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
                  {pkg.description ? (
                    <CardDescription>{pkg.description}</CardDescription>
                  ) : null}
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Templates" value={pkg.templates.length} />
                    <Stat label="Clients" value={pkg.clientCount} />
                  </div>

                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Service areas covered
                    </p>
                    {areas.length === 0 ? (
                      <p className="text-sm text-muted-foreground">—</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1">
                        {areas.map((area) => (
                          <li key={area}>
                            <Badge variant="outline">{area}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {pkg.serviceNames.length > 0 ? (
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">
                        Linked services
                      </p>
                      <p className="text-sm">{pkg.serviceNames.join(", ")}</p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {canViewTemplates ? (
                      <Link
                        href="/templates"
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        View templates
                      </Link>
                    ) : null}
                    {canViewClients && pkg.clientCount > 0 ? (
                      <Link
                        href={{ pathname: "/clients", query: { status: "ALL" } }}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                      >
                        Clients
                      </Link>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Each tier holds its own full set of templates rather than inheriting
        from the tier below, so a package&rsquo;s template count is its total.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
