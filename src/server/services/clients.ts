import { ContractStatus, EntityType, Prisma } from "@/generated/prisma/client";
import { ClientHealth } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { isDuplicateClient, validateClientFields } from "@/lib/domain/client";
import { CONTRACT_STATUS_LABELS } from "@/lib/domain/labels";
import { healthSortRank } from "@/lib/domain/health";
import type {
  ClientDetailViewModel,
  ClientListRow,
} from "@/lib/domain/view-models/clients";
import {
  buildClientDetailViewModel,
  buildClientsListViewModel,
} from "@/lib/domain/view-models/clients";
import {
  buildClientTaskSummary,
  buildServiceAreaProgress,
  buildUpcomingDeadlines,
  type ClientTaskSummary,
  type ServiceAreaProgress,
  type UpcomingDeadline,
} from "@/lib/domain/view-models/client-dashboard";
import type {
  ClientContactInput,
  ClientListQuery,
  CreateClientInput,
  UpdateClientInput,
} from "@/lib/validation/client";
import { ForbiddenError, type OrgContext } from "@/server/context";
import { ACTIVITY_ACTIONS, logActivity } from "@/server/services/activity";
import { recalculateClientHealth } from "@/server/services/health";
import { nextDisplayId } from "@/server/services/ids";
import {
  clientSelect,
  issueSelect,
  requestSelect,
  taskSelect,
  toDomainClient,
  toDomainIssue,
  toDomainRequest,
  toDomainTask,
} from "@/server/services/mappers";
import { recalculateClientProgress } from "@/server/services/progress";
import { generateOnboardingTasks } from "@/server/services/task-generation";

/**
 * Client service.
 *
 * Port of legacy `clients/ClientService.gs` (audit §6.9). `createClient`
 * preserves the legacy sequence exactly:
 *
 *   validate → reject duplicates → allocate ID → insert → log →
 *   generate onboarding tasks → recalculate progress → recalculate health
 *
 * The last two matter: legacy primed both so a brand-new client's dashboard
 * numbers are correct the instant it appears, rather than staying at zero
 * until the next nightly pass.
 */

export class ClientOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientOperationError";
  }
}

export const CLIENTS_PAGE_SIZE = 25;

export interface ClientListResult {
  rows: ClientListRow[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Client list with filtering, search, sorting, and pagination.
 *
 * Filtering and pagination happen in SQL (master prompt §47) — loading every
 * client to filter in memory would not survive a real book of business. The
 * default health ordering is the ported legacy rule, which SQL cannot express
 * directly, so it is applied to the page after retrieval; see the note on
 * `sort` below.
 */
export async function listClients(
  ctx: OrgContext,
  query: ClientListQuery,
): Promise<ClientListResult> {
  const where: Prisma.ClientWhereInput = {
    organizationId: ctx.organizationId,
    ...(query.includeArchived ? {} : { deletedAt: null }),
  };

  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { companyName: { contains: query.q, mode: "insensitive" } },
      { displayId: { contains: query.q, mode: "insensitive" } },
      { industry: { contains: query.q, mode: "insensitive" } },
    ];
  }

  if (query.status && query.status !== "ALL") {
    where.contractStatus = query.status;
  }
  if (query.health && query.health !== "ALL") {
    where.health = query.health as ClientHealth;
  }
  if (query.accountManagerId && query.accountManagerId !== "ALL") {
    where.accountManagerId = query.accountManagerId;
  }

  const total = await prisma.client.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / CLIENTS_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  // `health` is ordered by the ported rule, not by column value — the enum's
  // storage order is not the urgency order. Every other sort maps to SQL.
  const orderBy: Prisma.ClientOrderByWithRelationInput[] =
    query.sort === "name"
      ? [{ name: "asc" }]
      : query.sort === "completion"
        ? [{ weightedCompletionPct: "asc" }, { name: "asc" }]
        : query.sort === "nextDeadline"
          ? [{ nextDeadline: { sort: "asc", nulls: "last" } }, { name: "asc" }]
          : [{ name: "asc" }];

  const rows = await prisma.client.findMany({
    where,
    select: clientSelect,
    orderBy,
    skip: (page - 1) * CLIENTS_PAGE_SIZE,
    take: CLIENTS_PAGE_SIZE,
  });

  const domain = rows.map(toDomainClient);

  // buildClientsListViewModel applies legacy's health-then-name ordering.
  const listRows =
    query.sort === "health"
      ? buildClientsListViewModel(domain)
      : domain.map((client) => ({
          clientId: client.id,
          clientDisplayId: client.displayId,
          clientName: client.name,
          servicePackage: client.servicePackageName,
          accountManager: client.accountManagerName,
          contractStatus: client.contractStatus,
          health: client.health,
          completionPct: Number(client.weightedCompletionPct) || 0,
          nextDeadline: client.nextDeadline,
        }));

  return { rows: listRows, total, page, pageCount };
}

export interface ClientDetail {
  viewModel: ClientDetailViewModel;
  summary: ClientTaskSummary;
  serviceAreas: ServiceAreaProgress[];
  upcomingDeadlines: UpcomingDeadline[];
  isArchived: boolean;
  contacts: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  }[];
  services: string[];
  recentActivity: {
    id: string;
    action: string;
    previousValue: string | null;
    newValue: string | null;
    userEmail: string | null;
    createdAt: Date;
  }[];
}

/** Full client detail, assembled from the ported view models. */
export async function getClientDetail(
  ctx: OrgContext,
  clientId: string,
  today: Date = new Date(),
): Promise<ClientDetail | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId },
    select: {
      ...clientSelect,
      deletedAt: true,
      contacts: {
        where: { deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          name: true,
          role: true,
          email: true,
          phone: true,
          isPrimary: true,
        },
      },
      servicePackage: {
        select: {
          name: true,
          services: { select: { service: { select: { name: true } } } },
        },
      },
    },
  });
  if (!client) return null;

  const [taskRows, issueRows, requestRows, activity] = await Promise.all([
    prisma.task.findMany({
      where: { organizationId: ctx.organizationId, clientId, deletedAt: null },
      select: taskSelect,
    }),
    prisma.issue.findMany({
      where: { organizationId: ctx.organizationId, clientId, deletedAt: null },
      select: issueSelect,
    }),
    prisma.clientRequest.findMany({
      where: { organizationId: ctx.organizationId, clientId, deletedAt: null },
      select: requestSelect,
    }),
    prisma.activityLog.findMany({
      where: { organizationId: ctx.organizationId, clientId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        action: true,
        previousValue: true,
        newValue: true,
        userEmail: true,
        createdAt: true,
      },
    }),
  ]);

  const domainClient = toDomainClient(client);
  const tasks = taskRows.map(toDomainTask);

  const viewModel = buildClientDetailViewModel(
    clientId,
    [domainClient],
    tasks,
    issueRows.map(toDomainIssue),
    requestRows.map(toDomainRequest),
    today,
  );
  if (!viewModel) return null;

  return {
    viewModel,
    summary: buildClientTaskSummary(tasks, today),
    serviceAreas: buildServiceAreaProgress(tasks),
    upcomingDeadlines: buildUpcomingDeadlines(tasks, today, 8),
    isArchived: client.deletedAt !== null,
    contacts: client.contacts,
    services:
      client.servicePackage?.services.map((link) => link.service.name) ?? [],
    recentActivity: activity,
  };
}

/** Ensures the referenced package and members belong to the caller's organization. */
async function assertReferencesInOrg(
  ctx: OrgContext,
  input: { servicePackageId: string; accountManagerId: string; backupMemberId: string | null },
): Promise<void> {
  const [servicePackage, accountManager, backup] = await Promise.all([
    prisma.servicePackage.findFirst({
      where: {
        id: input.servicePackageId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    }),
    prisma.organizationMember.findFirst({
      where: {
        id: input.accountManagerId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: { id: true },
    }),
    input.backupMemberId
      ? prisma.organizationMember.findFirst({
          where: {
            id: input.backupMemberId,
            organizationId: ctx.organizationId,
            deletedAt: null,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  // A foreign id would otherwise link a client to another tenant's package or
  // staff member — the form supplies these, so they are never trusted.
  if (!servicePackage) {
    throw new ForbiddenError("Service package not found in this organization.");
  }
  if (!accountManager) {
    throw new ForbiddenError("Account manager not found in this organization.");
  }
  if (input.backupMemberId && !backup) {
    throw new ForbiddenError("Backup member not found in this organization.");
  }
}

/** Legacy `createNewClient`. */
export async function createClient(
  ctx: OrgContext,
  input: CreateClientInput,
  today: Date = new Date(),
): Promise<{ id: string; displayId: string; tasksCreated: number }> {
  // Tenancy is asserted BEFORE business validation. Legacy validated on
  // resolved names, so an id belonging to another organization would fail to
  // resolve and surface as "Service Package is required" — a refusal, but a
  // misleading one that sends the user hunting for a field they filled in.
  await assertReferencesInOrg(ctx, input);

  const [pkg, manager] = await Promise.all([
    prisma.servicePackage.findFirst({
      where: {
        id: input.servicePackageId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: { name: true },
    }),
    prisma.organizationMember.findFirst({
      where: {
        id: input.accountManagerId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      select: { user: { select: { name: true } } },
    }),
  ]);

  // Legacy's own validation, on the resolved names it checked.
  const validation = validateClientFields({
    name: input.name,
    servicePackageName: pkg?.name ?? null,
    accountManagerName: manager?.user.name ?? null,
    startDate: input.startDate,
  });
  if (!validation.valid) {
    throw new ClientOperationError(validation.errors.join(" "));
  }

  const existing = await prisma.client.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    select: { name: true, companyName: true },
  });

  if (
    isDuplicateClient(
      { name: input.name, companyName: input.companyName },
      existing,
    )
  ) {
    throw new ClientOperationError(
      `A client named "${input.name}" at "${input.companyName ?? "—"}" already exists.`,
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const displayId = await nextDisplayId(ctx.organizationId, "CLIENT", tx);

    const client = await tx.client.create({
      data: {
        organizationId: ctx.organizationId,
        displayId,
        name: input.name,
        companyName: input.companyName,
        industry: input.industry,
        businessType: input.businessType,
        startDate: input.startDate,
        servicePackageId: input.servicePackageId,
        accountManagerId: input.accountManagerId,
        backupMemberId: input.backupMemberId,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        accountingSystem: input.accountingSystem,
        reportingFrequency: input.reportingFrequency,
        monthEndClosingDay: input.monthEndClosingDay,
        // Legacy defaults a new client to Onboarding unless told otherwise.
        contractStatus: input.contractStatus ?? ContractStatus.ONBOARDING,
        priority: input.priority,
        health: ClientHealth.ON_TRACK,
        notes: input.notes,
      },
      select: { id: true, displayId: true },
    });

    await logActivity(
      ctx,
      {
        action: ACTIVITY_ACTIONS.CLIENT_ADDED,
        entityType: EntityType.CLIENT,
        entityId: client.id,
        clientId: client.id,
        newValue: input.name,
      },
      tx,
    );

    return client;
  });

  // Outside the transaction: generation creates many rows and then triggers
  // recalculation, and legacy treats a client as created even if generation
  // has nothing to produce.
  const generation = await generateOnboardingTasks(ctx, created.id, today);

  await recalculateClientProgress(ctx.organizationId, created.id);
  await recalculateClientHealth(ctx, created.id, today);

  return { ...created, tasksCreated: generation.tasksCreated };
}

/** Updates a client and re-derives anything the change affects. */
export async function updateClient(
  ctx: OrgContext,
  input: UpdateClientInput,
  today: Date = new Date(),
): Promise<void> {
  const current = await prisma.client.findFirst({
    where: { id: input.clientId, organizationId: ctx.organizationId },
    select: {
      id: true,
      name: true,
      companyName: true,
      contractStatus: true,
      servicePackageId: true,
    },
  });
  if (!current) {
    throw new ForbiddenError("Client not found in this organization.");
  }

  await assertReferencesInOrg(ctx, input);

  const others = await prisma.client.findMany({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      id: { not: input.clientId },
    },
    select: { name: true, companyName: true },
  });

  if (
    isDuplicateClient(
      { name: input.name, companyName: input.companyName },
      others,
    )
  ) {
    throw new ClientOperationError(
      `A client named "${input.name}" at "${input.companyName ?? "—"}" already exists.`,
    );
  }

  const statusChanged = current.contractStatus !== input.contractStatus;

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: input.clientId },
      data: {
        name: input.name,
        companyName: input.companyName,
        industry: input.industry,
        businessType: input.businessType,
        startDate: input.startDate,
        servicePackageId: input.servicePackageId,
        accountManagerId: input.accountManagerId,
        backupMemberId: input.backupMemberId,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        accountingSystem: input.accountingSystem,
        reportingFrequency: input.reportingFrequency,
        monthEndClosingDay: input.monthEndClosingDay,
        contractStatus: input.contractStatus,
        priority: input.priority,
        notes: input.notes,
      },
    });

    await logActivity(
      ctx,
      {
        action: ACTIVITY_ACTIONS.CLIENT_UPDATED,
        entityType: EntityType.CLIENT,
        entityId: input.clientId,
        clientId: input.clientId,
        previousValue: statusChanged
          ? CONTRACT_STATUS_LABELS[current.contractStatus]
          : current.name,
        newValue: statusChanged
          ? CONTRACT_STATUS_LABELS[input.contractStatus]
          : input.name,
      },
      tx,
    );
  });

  // Contract status feeds the health rule (On Hold is a hard override), so a
  // status change must re-derive health immediately rather than wait a day.
  if (statusChanged) {
    await recalculateClientHealth(ctx, input.clientId, today);
  }
}

/**
 * Archives or restores a client (master prompt §10).
 *
 * Soft delete: the row stays, so its tasks, issues, and history remain
 * intact and auditable. An archived client is excluded from the Control
 * Center and every default list.
 */
export async function setClientArchived(
  ctx: OrgContext,
  clientId: string,
  archived: boolean,
): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!client) {
    throw new ForbiddenError("Client not found in this organization.");
  }

  if ((client.deletedAt !== null) === archived) return;

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: { deletedAt: archived ? new Date() : null },
    });

    await logActivity(
      ctx,
      {
        action: ACTIVITY_ACTIONS.CLIENT_ARCHIVED,
        entityType: EntityType.CLIENT,
        entityId: clientId,
        clientId,
        previousValue: archived ? "Active" : "Archived",
        newValue: archived ? "Archived" : "Active",
      },
      tx,
    );
  });
}

/** Options for the client form's selects, always org-scoped. */
export async function getClientFormOptions(ctx: OrgContext) {
  const [packages, members] = await Promise.all([
    prisma.servicePackage.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId: ctx.organizationId,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);

  return {
    packages,
    members: members.map((m) => ({ id: m.id, name: m.user.name })),
  };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

async function requireClientInOrg(ctx: OrgContext, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!client) {
    throw new ForbiddenError("Client not found in this organization.");
  }
  return client;
}

export async function upsertClientContact(
  ctx: OrgContext,
  input: ClientContactInput,
): Promise<void> {
  await requireClientInOrg(ctx, input.clientId);

  const data = {
    name: input.name,
    role: input.role,
    email: input.email,
    phone: input.phone,
    isPrimary: input.isPrimary ?? false,
  };

  await prisma.$transaction(async (tx) => {
    // Only one primary contact per client — promoting one demotes the rest.
    if (data.isPrimary) {
      await tx.clientContact.updateMany({
        where: { clientId: input.clientId },
        data: { isPrimary: false },
      });
    }

    if (input.contactId) {
      const existing = await tx.clientContact.findFirst({
        where: { id: input.contactId, clientId: input.clientId },
        select: { id: true },
      });
      if (!existing) {
        throw new ForbiddenError("Contact not found for this client.");
      }
      await tx.clientContact.update({
        where: { id: input.contactId },
        data,
      });
    } else {
      await tx.clientContact.create({
        data: { clientId: input.clientId, ...data },
      });
    }
  });
}

export async function deleteClientContact(
  ctx: OrgContext,
  clientId: string,
  contactId: string,
): Promise<void> {
  await requireClientInOrg(ctx, clientId);

  const contact = await prisma.clientContact.findFirst({
    where: { id: contactId, clientId },
    select: { id: true },
  });
  if (!contact) {
    throw new ForbiddenError("Contact not found for this client.");
  }

  await prisma.clientContact.update({
    where: { id: contactId },
    data: { deletedAt: new Date() },
  });
}

export { healthSortRank };
