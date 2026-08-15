import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClientHealth,
  ContractStatus,
  OrgRole,
  Priority,
} from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { formatDisplayId } from "@/lib/domain/ids";
import { buildTaskTemplateCatalog } from "@/lib/domain/task-template-catalog";
import { ForbiddenError, type OrgContext } from "@/server/context";
import {
  ClientOperationError,
  createClient,
  deleteClientContact,
  getClientDetail,
  listClients,
  setClientArchived,
  updateClient,
  upsertClientContact,
} from "@/server/services/clients";
import { getControlCenterViewModel } from "@/server/services/dashboard";
import { seedOrgSettings } from "@/server/services/settings";

/**
 * Phase 4 integration tests — the Clients module through its real service
 * layer against PostgreSQL.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

const SLUG = "test-org-clients";
const OTHER_SLUG = "test-org-clients-other";
const EMAIL_DOMAIN = "@clients-test.example.com";

let ctx: OrgContext;
let otherCtx: OrgContext;
let packageId: string;
let otherPackageId: string;
let managerId: string;
let otherManagerId: string;

const TODAY = new Date(2026, 7, 15);

async function cleanup() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: [SLUG, OTHER_SLUG] } },
    select: { id: true },
  });
  if (orgs.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: orgs.map((o) => o.id) } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}

async function buildOrg(slug: string, name: string, prefix: string) {
  const org = await prisma.organization.create({
    data: { name, slug },
    select: { id: true, slug: true },
  });
  await seedOrgSettings(org.id);

  const user = await prisma.user.create({
    data: {
      name: "Jane AM",
      email: `${prefix}-owner${EMAIL_DOMAIN}`,
      passwordHash: "unused",
    },
    select: { id: true, name: true, email: true },
  });

  const member = await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      displayId: formatDisplayId("MEMBER", 1),
      role: OrgRole.OWNER,
      jobTitle: "Account Manager",
      isActive: true,
    },
    select: { id: true },
  });

  const pkg = await prisma.servicePackage.create({
    data: {
      organizationId: org.id,
      displayId: formatDisplayId("SERVICE_PACKAGE", 1),
      name: "Basic Accounting",
    },
    select: { id: true },
  });

  const catalog = buildTaskTemplateCatalog().filter(
    (entry) => entry.servicePackage === "Basic Accounting",
  );
  for (const [index, entry] of catalog.entries()) {
    await prisma.taskTemplate.create({
      data: {
        organizationId: org.id,
        displayId: formatDisplayId("TASK_TEMPLATE", index + 1),
        servicePackageId: pkg.id,
        serviceArea: entry.serviceArea,
        taskName: entry.taskName,
        frequency: entry.frequency,
        priority: entry.priority,
        defaultAssigneeRole: entry.defaultAssigneeRole,
        typicalDurationDays: entry.typicalDurationDays,
        requiresClientInput: entry.requiresClientInput,
      },
    });
  }

  await prisma.idSequence.createMany({
    data: [
      { organizationId: org.id, entity: "MEMBER", lastValue: 1 },
      { organizationId: org.id, entity: "CLIENT", lastValue: 0 },
      { organizationId: org.id, entity: "TASK", lastValue: 0 },
      { organizationId: org.id, entity: "ACTIVITY", lastValue: 0 },
      { organizationId: org.id, entity: "SERVICE_PACKAGE", lastValue: 1 },
      {
        organizationId: org.id,
        entity: "TASK_TEMPLATE",
        lastValue: catalog.length,
      },
    ],
  });

  const context: OrgContext = {
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    organizationId: org.id,
    organizationSlug: org.slug,
    membershipId: member.id,
    role: OrgRole.OWNER,
  };

  return { context, packageId: pkg.id, managerId: member.id };
}

function clientInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Northwind Retail",
    companyName: "Northwind Ltd",
    industry: "Retail",
    businessType: "Limited Company",
    startDate: new Date(2026, 0, 15),
    servicePackageId: packageId,
    accountManagerId: managerId,
    backupMemberId: null,
    contactName: "Finance Contact",
    email: "finance@northwind.example.com",
    phone: null,
    accountingSystem: "Xero",
    reportingFrequency: null,
    monthEndClosingDay: 5,
    contractStatus: ContractStatus.ACTIVE,
    priority: Priority.HIGH,
    notes: null,
    ...overrides,
  } as Parameters<typeof createClient>[1];
}

beforeAll(async () => {
  if (!hasDatabase) return;
  await cleanup();

  const primary = await buildOrg(SLUG, "Clients Test Org", "primary");
  ctx = primary.context;
  packageId = primary.packageId;
  managerId = primary.managerId;

  const secondary = await buildOrg(OTHER_SLUG, "Other Org", "secondary");
  otherCtx = secondary.context;
  otherPackageId = secondary.packageId;
  otherManagerId = secondary.managerId;
});

afterAll(async () => {
  if (!hasDatabase) return;
  await cleanup();
  await prisma.$disconnect();
});

suite("createClient", () => {
  it("runs the full legacy sequence and primes derived fields", async () => {
    const created = await createClient(ctx, clientInput(), TODAY);

    expect(created.displayId).toBe("CL-0001");
    // Onboarding tasks generated from the Basic Accounting catalog.
    expect(created.tasksCreated).toBe(9);

    const client = await prisma.client.findUnique({
      where: { id: created.id },
      select: {
        health: true,
        simpleCompletionPct: true,
        weightedCompletionPct: true,
        nextDeadline: true,
        contractStatus: true,
      },
    });

    // Legacy primed progress and health so a new client's numbers are right
    // immediately rather than after the nightly pass.
    expect(client?.simpleCompletionPct).toBe(0);
    expect(client?.nextDeadline).not.toBeNull();
    expect(client?.health).toBeDefined();
  });

  it("logs the creation against the client", async () => {
    const log = await prisma.activityLog.findFirst({
      where: { organizationId: ctx.organizationId, action: "Client Added" },
      select: { newValue: true, clientId: true, displayId: true },
    });

    expect(log?.newValue).toBe("Northwind Retail");
    expect(log?.clientId).not.toBeNull();
    expect(log?.displayId).toMatch(/^ACT-\d{7}$/);
  });

  it("stamps lastActivityAt via the activity logger", async () => {
    const client = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, name: "Northwind Retail" },
      select: { lastActivityAt: true },
    });
    expect(client?.lastActivityAt).not.toBeNull();
  });

  it("rejects a duplicate on name AND company together", async () => {
    await expect(
      createClient(ctx, clientInput(), TODAY),
    ).rejects.toBeInstanceOf(ClientOperationError);
  });

  it("allows the same name at a different company", async () => {
    const created = await createClient(
      ctx,
      clientInput({ companyName: "Northwind GmbH" }),
      TODAY,
    );
    expect(created.displayId).toBe("CL-0002");
  });

  it("refuses a service package from another organization", async () => {
    await expect(
      createClient(
        ctx,
        clientInput({ name: "Cross Tenant", servicePackageId: otherPackageId }),
        TODAY,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const leaked = await prisma.client.findFirst({
      where: { name: "Cross Tenant" },
      select: { id: true },
    });
    expect(leaked).toBeNull();
  });

  it("refuses an account manager from another organization", async () => {
    await expect(
      createClient(
        ctx,
        clientInput({ name: "Cross Manager", accountManagerId: otherManagerId }),
        TODAY,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allocates display ids per organization, not globally", async () => {
    const other = await createClient(
      otherCtx,
      {
        ...clientInput({ name: "Other Co" }),
        servicePackageId: otherPackageId,
        accountManagerId: otherManagerId,
      },
      TODAY,
    );
    // The other organization starts its own CL- series.
    expect(other.displayId).toBe("CL-0001");
  });
});

suite("updateClient", () => {
  it("recalculates health when contract status changes to On Hold", async () => {
    // Selected by company name: two clients share the name "Northwind
    // Retail", so findFirst on name alone is ambiguous.
    const client = await prisma.client.findFirst({
      where: {
        organizationId: ctx.organizationId,
        companyName: "Northwind Ltd",
      },
      select: { id: true },
    });

    await updateClient(
      ctx,
      {
        clientId: client!.id,
        ...clientInput({ contractStatus: ContractStatus.ON_HOLD }),
      } as Parameters<typeof updateClient>[1],
      TODAY,
    );

    const after = await prisma.client.findUnique({
      where: { id: client!.id },
      select: { health: true, contractStatus: true },
    });

    // On Hold is a hard override in the health rule.
    expect(after?.contractStatus).toBe(ContractStatus.ON_HOLD);
    expect(after?.health).toBe(ClientHealth.ON_HOLD);

    // Restore for later assertions.
    await updateClient(
      ctx,
      {
        clientId: client!.id,
        ...clientInput({ contractStatus: ContractStatus.ACTIVE }),
      } as Parameters<typeof updateClient>[1],
      TODAY,
    );
  });

  it("refuses to update a client in another organization", async () => {
    const foreign = await prisma.client.findFirst({
      where: { organizationId: otherCtx.organizationId },
      select: { id: true, name: true },
    });

    await expect(
      updateClient(
        ctx,
        {
          clientId: foreign!.id,
          ...clientInput({ name: "Hijacked" }),
        } as Parameters<typeof updateClient>[1],
        TODAY,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const untouched = await prisma.client.findUnique({
      where: { id: foreign!.id },
      select: { name: true },
    });
    expect(untouched?.name).toBe(foreign!.name);
  });

  it("rejects renaming into an existing name + company pair", async () => {
    const target = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, companyName: "Northwind GmbH" },
      select: { id: true },
    });

    await expect(
      updateClient(
        ctx,
        {
          clientId: target!.id,
          ...clientInput({ companyName: "Northwind Ltd" }),
        } as Parameters<typeof updateClient>[1],
        TODAY,
      ),
    ).rejects.toBeInstanceOf(ClientOperationError);
  });
});

suite("archive and restore", () => {
  it("soft-deletes, hides from the Control Center, and keeps history", async () => {
    const client = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, companyName: "Northwind GmbH" },
      select: { id: true },
    });

    const tasksBefore = await prisma.task.count({
      where: { clientId: client!.id },
    });

    await setClientArchived(ctx, client!.id, true);

    const row = await prisma.client.findUnique({
      where: { id: client!.id },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).not.toBeNull();

    // Tasks survive — archiving is not deletion.
    expect(await prisma.task.count({ where: { clientId: client!.id } })).toBe(
      tasksBefore,
    );

    const vm = await getControlCenterViewModel(ctx, TODAY);
    expect(vm.clientHealth.map((r) => r.clientId)).not.toContain(client!.id);
  });

  it("excludes archived clients from the default list but includes them on request", async () => {
    const visible = await listClients(ctx, {
      sort: "health",
      page: 1,
      includeArchived: false,
    });
    const all = await listClients(ctx, {
      sort: "health",
      page: 1,
      includeArchived: true,
    });

    expect(all.total).toBeGreaterThan(visible.total);
  });

  it("restores a client", async () => {
    const client = await prisma.client.findFirst({
      where: {
        organizationId: ctx.organizationId,
        companyName: "Northwind GmbH",
      },
      select: { id: true },
    });

    await setClientArchived(ctx, client!.id, false);
    const row = await prisma.client.findUnique({
      where: { id: client!.id },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).toBeNull();
  });

  it("refuses to archive a client in another organization", async () => {
    const foreign = await prisma.client.findFirst({
      where: { organizationId: otherCtx.organizationId },
      select: { id: true },
    });

    await expect(
      setClientArchived(ctx, foreign!.id, true),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

suite("listClients", () => {
  it("scopes results to the caller's organization", async () => {
    const mine = await listClients(ctx, { sort: "health", page: 1, includeArchived: false });
    const theirs = await listClients(otherCtx, { sort: "health", page: 1, includeArchived: false });

    expect(mine.rows.map((r) => r.clientName)).not.toContain("Other Co");
    expect(theirs.rows.map((r) => r.clientName)).toEqual(["Other Co"]);
  });

  it("searches name, company, and display id", async () => {
    const byName = await listClients(ctx, {
      q: "northwind",
      sort: "health",
      page: 1,
      includeArchived: false,
    });
    expect(byName.total).toBeGreaterThan(0);

    const byDisplayId = await listClients(ctx, {
      q: "CL-0001",
      sort: "health",
      page: 1,
      includeArchived: false,
    });
    expect(byDisplayId.total).toBe(1);

    const noMatch = await listClients(ctx, {
      q: "zzz-nothing-matches",
      sort: "health",
      page: 1,
      includeArchived: false,
    });
    expect(noMatch.total).toBe(0);
    expect(noMatch.rows).toEqual([]);
  });

  it("filters by contract status and health", async () => {
    const active = await listClients(ctx, {
      status: ContractStatus.ACTIVE,
      sort: "health",
      page: 1,
      includeArchived: false,
    });
    expect(
      active.rows.every((r) => r.contractStatus === ContractStatus.ACTIVE),
    ).toBe(true);

    const onHold = await listClients(ctx, {
      status: ContractStatus.ON_HOLD,
      sort: "health",
      page: 1,
      includeArchived: false,
    });
    expect(onHold.total).toBe(0);
  });

  it("orders by the ported health rule when sorting by urgency", async () => {
    const result = await listClients(ctx, {
      sort: "health",
      page: 1,
      includeArchived: false,
    });

    const rank = { DELAYED: 0, AT_RISK: 1, ON_TRACK: 2, ON_HOLD: 3 } as const;
    const ranks = result.rows.map((r) => rank[r.health]);
    expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("sorts by name when asked", async () => {
    const result = await listClients(ctx, {
      sort: "name",
      page: 1,
      includeArchived: false,
    });
    const names = result.rows.map((r) => r.clientName);
    expect([...names]).toEqual([...names].sort());
  });

  it("clamps a page beyond the end rather than returning nothing", async () => {
    const result = await listClients(ctx, {
      sort: "health",
      page: 99,
      includeArchived: false,
    });
    expect(result.page).toBe(result.pageCount);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

suite("getClientDetail", () => {
  it("assembles the ported view model with summaries", async () => {
    const client = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, companyName: "Northwind Ltd" },
      select: { id: true },
    });

    const detail = await getClientDetail(ctx, client!.id, TODAY);
    expect(detail).not.toBeNull();
    expect(detail?.viewModel.clientName).toBe("Northwind Retail");
    // 9 onboarding tasks, all open.
    expect(detail?.viewModel.tasks).toHaveLength(9);
    expect(detail?.summary.total).toBe(9);
    expect(detail?.serviceAreas.length).toBeGreaterThan(0);
    expect(detail?.services.length).toBeGreaterThanOrEqual(0);
    expect(detail?.recentActivity.length).toBeGreaterThan(0);
  });

  it("returns null for a client in another organization", async () => {
    const foreign = await prisma.client.findFirst({
      where: { organizationId: otherCtx.organizationId },
      select: { id: true },
    });
    expect(await getClientDetail(ctx, foreign!.id, TODAY)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(
      await getClientDetail(ctx, "33333333-3333-4333-8333-333333333333", TODAY),
    ).toBeNull();
  });
});

suite("client contacts", () => {
  let clientId: string;

  beforeAll(async () => {
    if (!hasDatabase) return;
    const client = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, companyName: "Northwind Ltd" },
      select: { id: true },
    });
    clientId = client!.id;
  });

  it("adds a contact", async () => {
    await upsertClientContact(ctx, {
      clientId,
      name: "Ada Ledger",
      role: "Finance Director",
      email: "ada@northwind.example.com",
      phone: null,
      isPrimary: true,
    });

    const contacts = await prisma.clientContact.findMany({
      where: { clientId, deletedAt: null },
      select: { name: true, isPrimary: true },
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.isPrimary).toBe(true);
  });

  it("keeps exactly one primary contact", async () => {
    await upsertClientContact(ctx, {
      clientId,
      name: "Ben Books",
      role: "Controller",
      email: null,
      phone: null,
      isPrimary: true,
    });

    const primaries = await prisma.clientContact.findMany({
      where: { clientId, deletedAt: null, isPrimary: true },
      select: { name: true },
    });
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.name).toBe("Ben Books");
  });

  it("refuses a contact against another organization's client", async () => {
    const foreign = await prisma.client.findFirst({
      where: { organizationId: otherCtx.organizationId },
      select: { id: true },
    });

    await expect(
      upsertClientContact(ctx, {
        clientId: foreign!.id,
        name: "Intruder",
        role: null,
        email: null,
        phone: null,
        isPrimary: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("soft-deletes a contact", async () => {
    const contact = await prisma.clientContact.findFirst({
      where: { clientId, deletedAt: null, name: "Ada Ledger" },
      select: { id: true },
    });

    await deleteClientContact(ctx, clientId, contact!.id);

    const row = await prisma.clientContact.findUnique({
      where: { id: contact!.id },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("refuses to delete a contact that belongs to a different client", async () => {
    const otherClient = await prisma.client.findFirst({
      where: {
        organizationId: ctx.organizationId,
        companyName: "Northwind GmbH",
      },
      select: { id: true },
    });
    const contact = await prisma.clientContact.findFirst({
      where: { clientId, deletedAt: null },
      select: { id: true },
    });

    await expect(
      deleteClientContact(ctx, otherClient!.id, contact!.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
