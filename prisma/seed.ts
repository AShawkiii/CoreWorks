/**
 * Development seed (master prompt §38).
 *
 * DEMO DATA — clearly marked. Every organization created here has
 * `slug: "demo-*"` and `isDemoData: true` in its settings, so a production
 * deployment can assert that no seeded organization exists.
 *
 * Deliberately does NOT generate tasks from templates. Template expansion,
 * due-date computation, and the frequency rules are legacy business logic
 * that is ported with its parity test suite in Phase 3 (audit §14.1);
 * reimplementing them here would create a second, divergent copy of the rules.
 * The tasks below are written explicitly as fixtures.
 *
 * For the same reason, derived fields (client health, completion %, next
 * deadline) are left at their schema defaults. They are populated by the
 * health and progress engines once those land in Phase 3 — a seeded value
 * would be a guess at a calculation this phase has not yet ported.
 */

import "dotenv/config";

import bcrypt from "bcryptjs";

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ContractStatus,
  IssueSeverity,
  IssueStatus,
  OrgRole,
  Priority,
  ReportingFrequency,
  RequestStatus,
  TaskCategory,
  TaskStatus,
} from "../src/generated/prisma/enums";
import {
  DEFAULT_SETTINGS,
  SETTING_CATEGORY,
  type SettingKey,
} from "../src/lib/domain/enums";
import { formatDisplayId } from "../src/lib/domain/ids";
import {
  buildTaskTemplateCatalog,
  catalogServiceAreas,
  SERVICE_PACKAGE_NAMES,
} from "../src/lib/domain/task-template-catalog";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORG_SLUG = "demo-meridian";
const DEMO_PASSWORD = "CoreWorks-Demo-2026";

const PACKAGE_DESCRIPTIONS: Record<string, string> = {
  [SERVICE_PACKAGE_NAMES.BASIC_ACCOUNTING]:
    "Core bookkeeping, reconciliation, and monthly statements.",
  [SERVICE_PACKAGE_NAMES.FULL_FINANCE]:
    "Basic Accounting plus budgeting, forecasting, and management reporting.",
  [SERVICE_PACKAGE_NAMES.CFO_FPA]:
    "Full Finance plus scenario modelling and strategic advisory.",
};

const PEOPLE = [
  {
    name: "Amara Okafor",
    email: "amara.okafor@example.com",
    role: OrgRole.OWNER,
    jobTitle: "Account Manager",
    department: "Client Delivery",
    capacity: 18,
  },
  {
    name: "Daniel Reyes",
    email: "daniel.reyes@example.com",
    role: OrgRole.MANAGER,
    jobTitle: "Senior Accountant",
    department: "Client Delivery",
    capacity: 22,
  },
  {
    name: "Priya Raman",
    email: "priya.raman@example.com",
    role: OrgRole.ACCOUNTANT,
    jobTitle: "FP&A Analyst",
    department: "Advisory",
    capacity: 20,
  },
  {
    name: "Tomas Novak",
    email: "tomas.novak@example.com",
    role: OrgRole.TEAM_MEMBER,
    jobTitle: "Bookkeeper",
    department: "Client Delivery",
    capacity: 26,
  },
  {
    name: "Helen Whitfield",
    email: "helen.whitfield@example.com",
    role: OrgRole.VIEWER,
    jobTitle: "CFO Advisor",
    department: "Advisory",
    capacity: null,
  },
] as const;

const CLIENTS = [
  { name: "Northwind Retail", industry: "Retail", pkg: SERVICE_PACKAGE_NAMES.FULL_FINANCE, status: ContractStatus.ACTIVE, priority: Priority.HIGH, am: 0 },
  { name: "Brightpath Clinics", industry: "Healthcare", pkg: SERVICE_PACKAGE_NAMES.CFO_FPA, status: ContractStatus.ACTIVE, priority: Priority.CRITICAL, am: 1 },
  { name: "Harbour Logistics", industry: "Transport", pkg: SERVICE_PACKAGE_NAMES.BASIC_ACCOUNTING, status: ContractStatus.ACTIVE, priority: Priority.MEDIUM, am: 1 },
  { name: "Vela Studios", industry: "Media", pkg: SERVICE_PACKAGE_NAMES.BASIC_ACCOUNTING, status: ContractStatus.ONBOARDING, priority: Priority.MEDIUM, am: 0 },
  { name: "Ironleaf Manufacturing", industry: "Manufacturing", pkg: SERVICE_PACKAGE_NAMES.FULL_FINANCE, status: ContractStatus.ACTIVE, priority: Priority.HIGH, am: 2 },
  { name: "Cobalt Software", industry: "Technology", pkg: SERVICE_PACKAGE_NAMES.CFO_FPA, status: ContractStatus.ACTIVE, priority: Priority.HIGH, am: 2 },
  { name: "Fenwick Property", industry: "Real Estate", pkg: SERVICE_PACKAGE_NAMES.FULL_FINANCE, status: ContractStatus.ON_HOLD, priority: Priority.LOW, am: 0 },
  { name: "Aurora Hospitality", industry: "Hospitality", pkg: SERVICE_PACKAGE_NAMES.BASIC_ACCOUNTING, status: ContractStatus.ACTIVE, priority: Priority.MEDIUM, am: 1 },
  { name: "Meadowlark Foods", industry: "Food & Beverage", pkg: SERVICE_PACKAGE_NAMES.FULL_FINANCE, status: ContractStatus.ACTIVE, priority: Priority.MEDIUM, am: 2 },
  { name: "Kestrel Energy", industry: "Energy", pkg: SERVICE_PACKAGE_NAMES.CFO_FPA, status: ContractStatus.ONBOARDING, priority: Priority.HIGH, am: 0 },
] as const;

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  console.log("Seeding CoreWorks demo data…");

  // Idempotent: wipe the demo organization and rebuild. Cascades remove all
  // dependent rows. Only ever touches the demo slug.
  await prisma.organization.deleteMany({ where: { slug: ORG_SLUG } });

  const organization = await prisma.organization.create({
    data: {
      name: "Meridian Advisory",
      slug: ORG_SLUG,
      timezone: "Europe/London",
      currency: "GBP",
      locale: "en-GB",
      theme: { create: {} },
    },
  });

  // Legacy SETTINGS defaults (audit §6.1). Editable per organization.
  await prisma.organizationSetting.createMany({
    data: (Object.keys(DEFAULT_SETTINGS) as SettingKey[]).map((key) => ({
      organizationId: organization.id,
      category: SETTING_CATEGORY[key],
      key,
      value: String(DEFAULT_SETTINGS[key]),
      description: null,
    })),
  });

  await prisma.organizationSetting.create({
    data: {
      organizationId: organization.id,
      category: "SYSTEM",
      key: "IS_DEMO_DATA",
      value: "true",
      description: "Marks this organization as seeded demo data.",
    },
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const members = [];
  for (const [index, person] of PEOPLE.entries()) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: { name: person.name, passwordHash },
      create: { name: person.name, email: person.email, passwordHash },
    });

    members.push(
      await prisma.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          displayId: formatDisplayId("MEMBER", index + 1),
          role: person.role,
          jobTitle: person.jobTitle,
          department: person.department,
          capacity: person.capacity,
          isActive: true,
        },
      }),
    );
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "MEMBER",
      lastValue: PEOPLE.length,
    },
  });

  // Services — one per distinct service area in the legacy catalog.
  const serviceAreas = catalogServiceAreas();
  const services = new Map<string, string>();
  for (const [index, area] of serviceAreas.entries()) {
    const service = await prisma.service.create({
      data: {
        organizationId: organization.id,
        displayId: formatDisplayId("SERVICE", index + 1),
        name: area,
        category: "Finance",
      },
    });
    services.set(area, service.id);
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "SERVICE",
      lastValue: serviceAreas.length,
    },
  });

  const catalog = buildTaskTemplateCatalog();
  const packageNames = Object.values(SERVICE_PACKAGE_NAMES);
  const packages = new Map<string, string>();

  for (const [index, packageName] of packageNames.entries()) {
    const areasInPackage = [
      ...new Set(
        catalog
          .filter((entry) => entry.servicePackage === packageName)
          .map((entry) => entry.serviceArea),
      ),
    ];

    const servicePackage = await prisma.servicePackage.create({
      data: {
        organizationId: organization.id,
        displayId: formatDisplayId("SERVICE_PACKAGE", index + 1),
        name: packageName,
        description: PACKAGE_DESCRIPTIONS[packageName] ?? null,
        services: {
          create: areasInPackage
            .map((area) => services.get(area))
            .filter((id): id is string => Boolean(id))
            .map((serviceId) => ({ serviceId })),
        },
      },
    });
    packages.set(packageName, servicePackage.id);
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "SERVICE_PACKAGE",
      lastValue: packageNames.length,
    },
  });

  // 47 template rows across the three tiers (audit §6.12).
  for (const [index, entry] of catalog.entries()) {
    const servicePackageId = packages.get(entry.servicePackage);
    if (!servicePackageId) continue;

    await prisma.taskTemplate.create({
      data: {
        organizationId: organization.id,
        displayId: formatDisplayId("TASK_TEMPLATE", index + 1),
        servicePackageId,
        serviceArea: entry.serviceArea,
        taskName: entry.taskName,
        description: entry.description,
        frequency: entry.frequency,
        priority: entry.priority,
        defaultAssigneeRole: entry.defaultAssigneeRole,
        typicalDurationDays: entry.typicalDurationDays,
        requiresClientInput: entry.requiresClientInput,
      },
    });
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "TASK_TEMPLATE",
      lastValue: catalog.length,
    },
  });

  const clientIds: string[] = [];
  for (const [index, client] of CLIENTS.entries()) {
    const accountManager = members[client.am];
    const created = await prisma.client.create({
      data: {
        organizationId: organization.id,
        displayId: formatDisplayId("CLIENT", index + 1),
        name: client.name,
        companyName: `${client.name} Ltd`,
        industry: client.industry,
        businessType: "Limited Company",
        startDate: daysFromNow(-120 - index * 15),
        servicePackageId: packages.get(client.pkg) ?? null,
        accountManagerId: accountManager?.id ?? null,
        backupMemberId: members[(client.am + 1) % members.length]?.id ?? null,
        contactName: "Finance Contact",
        email: `finance@${client.name.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`,
        accountingSystem: index % 2 === 0 ? "Xero" : "QuickBooks",
        reportingFrequency: ReportingFrequency.MONTHLY,
        monthEndClosingDay: 5,
        contractStatus: client.status,
        priority: client.priority,
      },
    });
    clientIds.push(created.id);
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "CLIENT",
      lastValue: CLIENTS.length,
    },
  });

  // Explicit task fixtures — NOT template-generated (see file header).
  const period = currentPeriod();
  const taskFixtures = [
    { client: 0, name: "Bank Reconciliation", area: "Bank Reconciliation", status: TaskStatus.IN_PROGRESS, priority: Priority.HIGH, due: 4, assignee: 3 },
    { client: 0, name: "Month-End Close", area: "Month-End Closing", status: TaskStatus.NOT_STARTED, priority: Priority.CRITICAL, due: -3, assignee: 1 },
    { client: 1, name: "Monthly P&L", area: "P&L", status: TaskStatus.IN_REVIEW, priority: Priority.HIGH, due: 2, assignee: 1 },
    { client: 1, name: "Cash Forecast", area: "Cash Forecasting", status: TaskStatus.WAITING_CLIENT, priority: Priority.HIGH, due: -1, assignee: 2 },
    { client: 2, name: "AP", area: "Accounts Payable", status: TaskStatus.COMPLETED, priority: Priority.MEDIUM, due: -8, assignee: 3 },
    { client: 2, name: "AR", area: "Accounts Receivable", status: TaskStatus.BLOCKED, priority: Priority.MEDIUM, due: -5, assignee: 3 },
    { client: 4, name: "Budget vs Actual", area: "Budget vs Actual", status: TaskStatus.IN_PROGRESS, priority: Priority.HIGH, due: 6, assignee: 2 },
    { client: 5, name: "Rolling Forecast", area: "Forecasting", status: TaskStatus.NOT_STARTED, priority: Priority.HIGH, due: 12, assignee: 2 },
    { client: 5, name: "KPI Dashboard", area: "KPI Reporting", status: TaskStatus.COMPLETED, priority: Priority.MEDIUM, due: -10, assignee: 2 },
    { client: 7, name: "GL Review", area: "General Ledger", status: TaskStatus.IN_PROGRESS, priority: Priority.HIGH, due: 1, assignee: 1 },
    { client: 8, name: "Management Reporting", area: "Management Reporting", status: TaskStatus.NOT_STARTED, priority: Priority.HIGH, due: 9, assignee: 0 },
    { client: 8, name: "Monthly Cash Flow", area: "Cash Flow", status: TaskStatus.WAITING_CLIENT, priority: Priority.HIGH, due: -2, assignee: 3 },
  ] as const;

  for (const [index, fixture] of taskFixtures.entries()) {
    const clientId = clientIds[fixture.client];
    if (!clientId) continue;

    const isComplete = fixture.status === TaskStatus.COMPLETED;
    await prisma.task.create({
      data: {
        organizationId: organization.id,
        displayId: formatDisplayId("TASK", index + 1),
        clientId,
        serviceArea: fixture.area,
        taskCategory: TaskCategory.RECURRING,
        taskName: fixture.name,
        period,
        assignedToId: members[fixture.assignee]?.id ?? null,
        priority: fixture.priority,
        status: fixture.status,
        dueDate: daysFromNow(fixture.due),
        completionDate: isComplete ? daysFromNow(fixture.due) : null,
        completionPct: isComplete ? 1 : 0,
      },
    });
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "TASK",
      lastValue: taskFixtures.length,
    },
  });

  const issueFixtures = [
    { client: 1, title: "Missing Q3 bank statements", severity: IssueSeverity.CRITICAL, status: IssueStatus.OPEN, deadline: -2, assignee: 1 },
    { client: 0, title: "Payroll journal mismatch", severity: IssueSeverity.HIGH, status: IssueStatus.IN_PROGRESS, deadline: 5, assignee: 3 },
    { client: 4, title: "Inventory valuation method unclear", severity: IssueSeverity.MEDIUM, status: IssueStatus.OPEN, deadline: 14, assignee: 2 },
    { client: 5, title: "Revenue recognition policy review", severity: IssueSeverity.HIGH, status: IssueStatus.OPEN, deadline: 8, assignee: 2 },
    { client: 2, title: "Duplicate supplier records", severity: IssueSeverity.LOW, status: IssueStatus.RESOLVED, deadline: -20, assignee: 3 },
  ] as const;

  for (const [index, fixture] of issueFixtures.entries()) {
    const clientId = clientIds[fixture.client];
    if (!clientId) continue;

    await prisma.issue.create({
      data: {
        organizationId: organization.id,
        displayId: formatDisplayId("ISSUE", index + 1),
        clientId,
        title: fixture.title,
        category: "Data Quality",
        severity: fixture.severity,
        status: fixture.status,
        assignedToId: members[fixture.assignee]?.id ?? null,
        dateRaised: daysFromNow(-25 + index * 3),
        deadline: daysFromNow(fixture.deadline),
        requiredAction: "Obtain and reconcile supporting documentation.",
        resolutionDate:
          fixture.status === IssueStatus.RESOLVED ? daysFromNow(-18) : null,
      },
    });
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "ISSUE",
      lastValue: issueFixtures.length,
    },
  });

  const requestFixtures = [
    { client: 0, title: "September bank statements", status: RequestStatus.REQUESTED, requested: -19, assignee: 3 },
    { client: 1, title: "Payroll register (Q3)", status: RequestStatus.PARTIALLY_RECEIVED, requested: -9, assignee: 1 },
    { client: 2, title: "Supplier contracts", status: RequestStatus.RECEIVED, requested: -22, assignee: 3 },
    { client: 4, title: "Stock count sheets", status: RequestStatus.REQUESTED, requested: -5, assignee: 2 },
    { client: 8, title: "Signed board minutes", status: RequestStatus.REQUESTED, requested: -2, assignee: 0 },
  ] as const;

  for (const [index, fixture] of requestFixtures.entries()) {
    const clientId = clientIds[fixture.client];
    if (!clientId) continue;

    await prisma.clientRequest.create({
      data: {
        organizationId: organization.id,
        displayId: formatDisplayId("CLIENT_REQUEST", index + 1),
        clientId,
        title: fixture.title,
        status: fixture.status,
        priority: Priority.MEDIUM,
        requestedDate: daysFromNow(fixture.requested),
        requiredBy: daysFromNow(fixture.requested + 14),
        receivedDate:
          fixture.status === RequestStatus.RECEIVED
            ? daysFromNow(fixture.requested + 6)
            : null,
        assignedToId: members[fixture.assignee]?.id ?? null,
      },
    });
  }
  await prisma.idSequence.create({
    data: {
      organizationId: organization.id,
      entity: "CLIENT_REQUEST",
      lastValue: requestFixtures.length,
    },
  });

  console.log(`  organization   ${organization.name} (${ORG_SLUG})`);
  console.log(`  members        ${PEOPLE.length}`);
  console.log(`  services       ${serviceAreas.length}`);
  console.log(`  packages       ${packageNames.length}`);
  console.log(`  templates      ${catalog.length}`);
  console.log(`  clients        ${CLIENTS.length}`);
  console.log(`  tasks          ${taskFixtures.length}`);
  console.log(`  issues         ${issueFixtures.length}`);
  console.log(`  requests       ${requestFixtures.length}`);
  console.log(`\n  Sign in: ${PEOPLE[0].email} / ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
