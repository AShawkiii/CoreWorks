import type { Prisma } from "@/generated/prisma/client";
import type {
  DomainClient,
  DomainCloseStage,
  DomainIssue,
  DomainMember,
  DomainRequest,
  DomainTask,
  DomainTaskTemplate,
} from "@/lib/domain/types";

/**
 * Prisma row → domain record.
 *
 * The domain layer never sees a Prisma model. Everything crosses through here,
 * which is what keeps the business rules free of the ORM and testable without
 * a database (Phase 3 requirement).
 *
 * The `select` shapes below are the contract: a query that feeds a domain
 * function must select these fields, and the compiler enforces it.
 */

export const clientSelect = {
  id: true,
  displayId: true,
  name: true,
  companyName: true,
  industry: true,
  businessType: true,
  contactName: true,
  email: true,
  phone: true,
  contractStatus: true,
  priority: true,
  health: true,
  simpleCompletionPct: true,
  weightedCompletionPct: true,
  lastActivityAt: true,
  nextDeadline: true,
  notes: true,
  servicePackage: { select: { name: true } },
  accountManager: { select: { user: { select: { name: true } } } },
  backupMember: { select: { user: { select: { name: true } } } },
} satisfies Prisma.ClientSelect;

type ClientRow = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;

export function toDomainClient(row: ClientRow): DomainClient {
  return {
    id: row.id,
    displayId: row.displayId,
    name: row.name,
    companyName: row.companyName,
    industry: row.industry,
    businessType: row.businessType,
    servicePackageName: row.servicePackage?.name ?? null,
    accountManagerName: row.accountManager?.user.name ?? null,
    backupMemberName: row.backupMember?.user.name ?? null,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    contractStatus: row.contractStatus,
    priority: row.priority,
    health: row.health,
    simpleCompletionPct: row.simpleCompletionPct,
    weightedCompletionPct: row.weightedCompletionPct,
    lastActivityAt: row.lastActivityAt,
    nextDeadline: row.nextDeadline,
    notes: row.notes,
  };
}

export const taskSelect = {
  id: true,
  displayId: true,
  clientId: true,
  serviceArea: true,
  taskName: true,
  period: true,
  frequency: true,
  priority: true,
  status: true,
  dueDate: true,
  completionDate: true,
  completionPct: true,
  reviewStatus: true,
  client: { select: { name: true } },
  assignedTo: { select: { user: { select: { name: true } } } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export function toDomainTask(row: TaskRow): DomainTask {
  return {
    id: row.id,
    displayId: row.displayId,
    clientId: row.clientId,
    clientName: row.client.name,
    serviceArea: row.serviceArea,
    taskName: row.taskName,
    period: row.period,
    frequency: row.frequency,
    assignedToName: row.assignedTo?.user.name ?? null,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate,
    completionDate: row.completionDate,
    completionPct: row.completionPct,
    reviewStatus: row.reviewStatus,
  };
}

export const issueSelect = {
  id: true,
  displayId: true,
  clientId: true,
  title: true,
  category: true,
  severity: true,
  status: true,
  dateRaised: true,
  deadline: true,
  requiredAction: true,
  client: { select: { name: true } },
  assignedTo: { select: { user: { select: { name: true } } } },
} satisfies Prisma.IssueSelect;

type IssueRow = Prisma.IssueGetPayload<{ select: typeof issueSelect }>;

export function toDomainIssue(row: IssueRow): DomainIssue {
  return {
    id: row.id,
    displayId: row.displayId,
    clientId: row.clientId,
    clientName: row.client.name,
    title: row.title,
    category: row.category,
    severity: row.severity,
    status: row.status,
    assignedToName: row.assignedTo?.user.name ?? null,
    dateRaised: row.dateRaised,
    deadline: row.deadline,
    requiredAction: row.requiredAction,
  };
}

export const requestSelect = {
  id: true,
  displayId: true,
  clientId: true,
  title: true,
  status: true,
  priority: true,
  requestedDate: true,
  requiredBy: true,
  receivedDate: true,
  client: { select: { name: true } },
  assignedTo: { select: { user: { select: { name: true } } } },
} satisfies Prisma.ClientRequestSelect;

type RequestRow = Prisma.ClientRequestGetPayload<{
  select: typeof requestSelect;
}>;

export function toDomainRequest(row: RequestRow): DomainRequest {
  return {
    id: row.id,
    displayId: row.displayId,
    clientId: row.clientId,
    clientName: row.client.name,
    title: row.title,
    status: row.status,
    priority: row.priority,
    requestedDate: row.requestedDate,
    requiredBy: row.requiredBy,
    receivedDate: row.receivedDate,
    assignedToName: row.assignedTo?.user.name ?? null,
  };
}

export const memberSelect = {
  id: true,
  jobTitle: true,
  isActive: true,
  capacity: true,
  user: { select: { name: true } },
} satisfies Prisma.OrganizationMemberSelect;

type MemberRow = Prisma.OrganizationMemberGetPayload<{
  select: typeof memberSelect;
}>;

export function toDomainMember(row: MemberRow): DomainMember {
  return {
    id: row.id,
    name: row.user.name,
    jobTitle: row.jobTitle,
    isActive: row.isActive,
    capacity: row.capacity,
  };
}

export const templateSelect = {
  id: true,
  serviceArea: true,
  taskName: true,
  description: true,
  frequency: true,
  priority: true,
  defaultAssigneeRole: true,
  typicalDurationDays: true,
  requiresClientInput: true,
  isActive: true,
  servicePackage: { select: { name: true } },
} satisfies Prisma.TaskTemplateSelect;

type TemplateRow = Prisma.TaskTemplateGetPayload<{
  select: typeof templateSelect;
}>;

export function toDomainTemplate(row: TemplateRow): DomainTaskTemplate {
  return {
    id: row.id,
    servicePackageName: row.servicePackage.name,
    serviceArea: row.serviceArea,
    taskName: row.taskName,
    description: row.description,
    frequency: row.frequency,
    priority: row.priority,
    defaultAssigneeRole: row.defaultAssigneeRole,
    typicalDurationDays: row.typicalDurationDays,
    requiresClientInput: row.requiresClientInput,
    isActive: row.isActive,
  };
}

export const closeStageSelect = {
  stageName: true,
  stageOrder: true,
  status: true,
} satisfies Prisma.MonthlyCloseTaskSelect;

type CloseStageRow = Prisma.MonthlyCloseTaskGetPayload<{
  select: typeof closeStageSelect;
}>;

export function toDomainCloseStage(row: CloseStageRow): DomainCloseStage {
  return {
    stageName: row.stageName,
    stageOrder: row.stageOrder,
    status: row.status,
  };
}
