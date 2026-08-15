import { prisma } from "@/lib/db";
import type { Frequency, Priority } from "@/generated/prisma/enums";
import type { OrgContext } from "@/server/context";

/**
 * Service, package, and task-template catalog reads (audit §6.12).
 *
 * Read-only. Legacy's catalog lived in `templates/TaskTemplatesData.gs` and
 * was seeded into sheets; CoreWorks seeds it into the database per
 * organization, so these screens report what a tenant actually has rather than
 * what the source file says. A tenant that has edited its templates sees its
 * own, which is the point of the seed being data rather than code.
 */

export interface TemplateRow {
  id: string;
  displayId: string;
  serviceArea: string;
  taskName: string;
  description: string | null;
  frequency: Frequency;
  priority: Priority;
  defaultAssigneeRole: string | null;
  typicalDurationDays: number;
  requiresClientInput: boolean;
  isActive: boolean;
}

export interface PackageWithTemplates {
  id: string;
  displayId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  clientCount: number;
  serviceNames: string[];
  templates: TemplateRow[];
}

/**
 * Every package with its templates.
 *
 * Each tier carries its OWN full set of template rows rather than referencing
 * a shared pool — legacy queried templates by exact package match, so Full
 * Finance holds Basic's nine plus its own seven as sixteen rows of its own
 * (audit §6.12). The counts on this screen are therefore per-package totals,
 * not increments.
 */
export async function getPackageCatalog(
  ctx: OrgContext,
): Promise<PackageWithTemplates[]> {
  const packages = await prisma.servicePackage.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: { displayId: "asc" },
    select: {
      id: true,
      displayId: true,
      name: true,
      description: true,
      isActive: true,
      _count: { select: { clients: true } },
      services: { select: { service: { select: { name: true } } } },
      taskTemplates: {
        where: { deletedAt: null },
        orderBy: [{ serviceArea: "asc" }, { taskName: "asc" }],
        select: {
          id: true,
          displayId: true,
          serviceArea: true,
          taskName: true,
          description: true,
          frequency: true,
          priority: true,
          defaultAssigneeRole: true,
          typicalDurationDays: true,
          requiresClientInput: true,
          isActive: true,
        },
      },
    },
  });

  return packages.map((pkg) => ({
    id: pkg.id,
    displayId: pkg.displayId,
    name: pkg.name,
    description: pkg.description,
    isActive: pkg.isActive,
    clientCount: pkg._count.clients,
    serviceNames: pkg.services.map((link) => link.service.name).sort(),
    templates: pkg.taskTemplates,
  }));
}

export interface ServiceRow {
  id: string;
  displayId: string;
  name: string;
  category: string | null;
  description: string | null;
  isActive: boolean;
  packageNames: string[];
}

export async function getServiceCatalog(
  ctx: OrgContext,
): Promise<ServiceRow[]> {
  const services = await prisma.service.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      displayId: true,
      name: true,
      category: true,
      description: true,
      isActive: true,
      packages: { select: { servicePackage: { select: { name: true } } } },
    },
  });

  return services.map((service) => ({
    id: service.id,
    displayId: service.displayId,
    name: service.name,
    category: service.category,
    description: service.description,
    isActive: service.isActive,
    packageNames: service.packages
      .map((link) => link.servicePackage.name)
      .sort(),
  }));
}

/** Counts for the templates page header. */
export async function getCatalogTotals(ctx: OrgContext) {
  const [templates, activeTemplates, packages, services] = await Promise.all([
    prisma.taskTemplate.count({
      where: { organizationId: ctx.organizationId, deletedAt: null },
    }),
    prisma.taskTemplate.count({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        isActive: true,
      },
    }),
    prisma.servicePackage.count({
      where: { organizationId: ctx.organizationId, deletedAt: null },
    }),
    prisma.service.count({
      where: { organizationId: ctx.organizationId, deletedAt: null },
    }),
  ]);

  return { templates, activeTemplates, packages, services };
}
