import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
import { hasPermission } from "@/server/auth/permissions";
import { getServiceCatalog } from "@/server/services/catalog";
import { getOrgContext } from "@/server/tenancy";

export const metadata: Metadata = {
  title: "Services",
};

export default async function ServicesPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!hasPermission(ctx.role, "service:view")) notFound();

  const services = await getServiceCatalog(ctx);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Services"
        description={`${services.length} service${services.length === 1 ? "" : "s"} the firm offers, and the packages each belongs to.`}
        actions={
          <Link
            href="/service-packages"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Service packages
          </Link>
        }
      />

      <Card className="overflow-hidden">
        {services.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">No services yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Services are seeded with the organization.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Packages</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((service) => (
                <TableRow key={service.id}>
                  <TableCell className="font-medium">
                    {service.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {service.displayId}
                    </span>
                    {!service.isActive ? (
                      <Badge variant="neutral" className="ml-2">
                        Inactive
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {service.category ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {service.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {service.packageNames.length === 0
                      ? "—"
                      : service.packageNames.join(", ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Legacy stored a package&rsquo;s included service areas as free text in a
        single cell. Here the relationship is a real join, so a service can be
        traced to every package that includes it.
      </p>
    </div>
  );
}
