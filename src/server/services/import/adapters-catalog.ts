import { Frequency, OrgRole, Priority } from "@/generated/prisma/enums";
import { formatDisplayId } from "@/lib/domain/ids";
import {
  isBlank,
  parseFrequency,
  parseLegacyInt,
  parsePriority,
  parseText,
  parseYesNo,
} from "@/lib/domain/legacy-values";
import type { OrgContext } from "@/server/context";
import { nextDisplayId } from "@/server/services/ids";

import type { Db, ImportAdapter, Lookups, ParseResult } from "./types";

/**
 * Import adapters for the four sheets that come first in dependency order:
 * EMPLOYEES, SERVICES, SERVICE_PACKAGES, TASK_TEMPLATES.
 *
 * Every adapter here follows the same three rules from migration-plan §4:
 * an unrecognised enum is a **rejection, never a silent coercion**; the
 * dedupe key reuses whatever legacy already treated as identity; and the
 * display ID is preserved when the file supplies one (§3.5).
 */

/** Re-uses an imported display ID, or mints the next one. */
async function displayIdFor(
  ctx: OrgContext,
  db: Db,
  entity: Parameters<typeof nextDisplayId>[1],
  supplied: string | null,
): Promise<string> {
  return supplied && supplied.trim() !== ""
    ? supplied.trim()
    : nextDisplayId(ctx.organizationId, entity, db);
}

// ---------------------------------------------------------------------------
// EMPLOYEES → User + OrganizationMember
// ---------------------------------------------------------------------------

export interface EmployeeRow {
  displayId: string | null;
  name: string;
  email: string;
  /** Legacy EMPLOYEES.Role — a JOB TITLE, never an access role (audit §10). */
  jobTitle: string | null;
  department: string | null;
  isActive: boolean;
  managerName: string | null;
  capacity: number | null;
  notes: string | null;
}

export const employeeAdapter: ImportAdapter<EmployeeRow> = {
  sheet: "EMPLOYEES",
  idEntity: "MEMBER",
  idColumn: "Employee ID",

  parse(read): ParseResult<EmployeeRow> {
    const name = read("Employee Name");
    if (isBlank(name)) return { ok: false, reason: "Employee Name is required." };

    const email = read("Email").trim().toLowerCase();
    if (isBlank(email)) return { ok: false, reason: "Email is required." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, reason: `"${email}" is not a valid email address.` };
    }

    const activeCell = read("Active?");
    const isActive = parseYesNo(activeCell);
    if (!isBlank(activeCell) && isActive === null) {
      return {
        ok: false,
        reason: `Active? must be Yes or No, not "${activeCell}".`,
      };
    }

    const capacityCell = read("Capacity");
    const capacity = parseLegacyInt(capacityCell);
    if (!isBlank(capacityCell) && capacity === null) {
      return {
        ok: false,
        reason: `Capacity must be a whole number, not "${capacityCell}".`,
      };
    }
    if (capacity !== null && capacity < 0) {
      return { ok: false, reason: "Capacity cannot be negative." };
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Employee ID")),
        name: name.trim(),
        email,
        // Legacy `Role` is a job title — Bookkeeper, Senior Accountant. It
        // drives template assignee resolution (audit §6.10) and is
        // deliberately NOT an access-control input.
        jobTitle: parseText(read("Role")),
        department: parseText(read("Department")),
        // Legacy default when the cell is blank: an employee row exists
        // because they work here.
        isActive: isActive ?? true,
        managerName: parseText(read("Manager")),
        capacity,
        notes: parseText(read("Notes")),
      },
    };
  },

  // Email is the only true identity: legacy's own access check was "email
  // present in EMPLOYEES and Active? = Yes" (audit §10), and two colleagues
  // can share a name.
  dedupeKey: (value) => value.email,

  async existingKeys(ctx, db) {
    const members = await db.organizationMember.findMany({
      where: { organizationId: ctx.organizationId },
      select: { user: { select: { email: true } } },
    });
    return new Set(members.map((m) => m.user.email.toLowerCase()));
  },

  async insert(ctx, db, value) {
    // A User may already exist from another organization — identity is global
    // and membership is per-tenant (audit §14.3). Reusing it is correct;
    // creating a second row for the same person would not be.
    const user = await db.user.upsert({
      where: { email: value.email },
      create: { name: value.name, email: value.email },
      update: {},
      select: { id: true },
    });

    const displayId = await displayIdFor(ctx, db, "MEMBER", value.displayId);

    await db.organizationMember.create({
      data: {
        organizationId: ctx.organizationId,
        userId: user.id,
        displayId,
        // Imported staff land as TEAM_MEMBER. Legacy had no access roles at
        // all, so there is nothing to migrate and nothing to infer; promoting
        // from a job title would invent an authorization decision the source
        // data never made.
        role: OrgRole.TEAM_MEMBER,
        jobTitle: value.jobTitle,
        department: value.department,
        capacity: value.capacity,
        isActive: value.isActive,
        notes: value.notes,
      },
    });
  },

  label: (value) => value.name,
};

// ---------------------------------------------------------------------------
// SERVICES → Service
// ---------------------------------------------------------------------------

export interface ServiceRow {
  displayId: string | null;
  name: string;
  category: string | null;
  description: string | null;
  isActive: boolean;
}

export const serviceAdapter: ImportAdapter<ServiceRow> = {
  sheet: "SERVICES",
  idEntity: "SERVICE",
  idColumn: "Service ID",

  parse(read): ParseResult<ServiceRow> {
    const name = read("Service Name");
    if (isBlank(name)) return { ok: false, reason: "Service Name is required." };

    const activeCell = read("Active?");
    const isActive = parseYesNo(activeCell);
    if (!isBlank(activeCell) && isActive === null) {
      return {
        ok: false,
        reason: `Active? must be Yes or No, not "${activeCell}".`,
      };
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Service ID")),
        name: name.trim(),
        category: parseText(read("Category")),
        description: parseText(read("Description")),
        isActive: isActive ?? true,
      },
    };
  },

  // Matches the schema's own @@unique([organizationId, name]).
  dedupeKey: (value) => value.name.toLowerCase(),

  async existingKeys(ctx, db) {
    const services = await db.service.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true },
    });
    return new Set(services.map((s) => s.name.toLowerCase()));
  },

  async insert(ctx, db, value) {
    await db.service.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: await displayIdFor(ctx, db, "SERVICE", value.displayId),
        name: value.name,
        category: value.category,
        description: value.description,
        isActive: value.isActive,
      },
    });
  },

  label: (value) => value.name,
};

// ---------------------------------------------------------------------------
// SERVICE_PACKAGES → ServicePackage (+ ServicePackageService)
// ---------------------------------------------------------------------------

export interface ServicePackageRow {
  displayId: string | null;
  name: string;
  description: string | null;
  /** Parsed from the free-text "Included Service Areas" cell. */
  serviceNames: string[];
  isActive: boolean;
}

/**
 * Splits legacy's free-text service-area cell.
 *
 * DEVIATION (audit §14.3): legacy stored `Included Service Areas` as one
 * comma-separated cell; CoreWorks normalises it to a join table. Splitting on
 * commas AND semicolons because both appear in hand-maintained sheets, and an
 * entry that matches no known service is reported rather than dropped.
 */
export function splitServiceAreas(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export const servicePackageAdapter: ImportAdapter<ServicePackageRow> = {
  sheet: "SERVICE_PACKAGES",
  idEntity: "SERVICE_PACKAGE",
  idColumn: "Package ID",

  parse(read, lookups): ParseResult<ServicePackageRow> {
    const name = read("Package Name");
    if (isBlank(name)) return { ok: false, reason: "Package Name is required." };

    const activeCell = read("Active?");
    const isActive = parseYesNo(activeCell);
    if (!isBlank(activeCell) && isActive === null) {
      return {
        ok: false,
        reason: `Active? must be Yes or No, not "${activeCell}".`,
      };
    }

    const named = splitServiceAreas(read("Included Service Areas"));
    const matched: string[] = [];
    const warnings = [];

    for (const serviceName of named) {
      if (lookups.servicesByName.has(serviceName.toLowerCase())) {
        matched.push(serviceName);
      } else {
        // Warn and continue: the package is still real and usable without a
        // link to a service row that was never exported.
        warnings.push({
          column: "Included Service Areas",
          value: serviceName,
          occurrences: 1,
          action: "left blank" as const,
        });
      }
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Package ID")),
        name: name.trim(),
        description: parseText(read("Description")),
        serviceNames: matched,
        isActive: isActive ?? true,
      },
      warnings,
    };
  },

  dedupeKey: (value) => value.name.toLowerCase(),

  async existingKeys(ctx, db) {
    const packages = await db.servicePackage.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true },
    });
    return new Set(packages.map((p) => p.name.toLowerCase()));
  },

  async insert(ctx, db, value) {
    const created = await db.servicePackage.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: await displayIdFor(
          ctx,
          db,
          "SERVICE_PACKAGE",
          value.displayId,
        ),
        name: value.name,
        description: value.description,
        isActive: value.isActive,
      },
      select: { id: true },
    });

    if (value.serviceNames.length === 0) return;

    const services = await db.service.findMany({
      where: {
        organizationId: ctx.organizationId,
        name: { in: value.serviceNames },
      },
      select: { id: true },
    });

    await db.servicePackageService.createMany({
      data: services.map((service) => ({
        servicePackageId: created.id,
        serviceId: service.id,
      })),
      skipDuplicates: true,
    });
  },

  label: (value) => value.name,
};

// ---------------------------------------------------------------------------
// TASK_TEMPLATES → TaskTemplate
// ---------------------------------------------------------------------------

export interface TaskTemplateRow {
  displayId: string | null;
  servicePackageId: string;
  packageName: string;
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

export const taskTemplateAdapter: ImportAdapter<TaskTemplateRow> = {
  sheet: "TASK_TEMPLATES",
  idEntity: "TASK_TEMPLATE",
  idColumn: "Template ID",

  parse(read, lookups): ParseResult<TaskTemplateRow> {
    const packageName = read("Service Package");
    if (isBlank(packageName)) {
      return { ok: false, reason: "Service Package is required." };
    }

    const servicePackageId = lookups.packagesByName.get(
      packageName.trim().toLowerCase(),
    );
    if (!servicePackageId) {
      // Rejected, not warned: a template with no package can never be
      // generated from, so importing it would create a row that does nothing.
      return {
        ok: false,
        reason: `Service Package "${packageName}" was not found. Import Service Packages first.`,
      };
    }

    const serviceArea = read("Service Area");
    if (isBlank(serviceArea)) {
      return { ok: false, reason: "Service Area is required." };
    }

    const taskName = read("Task Name");
    if (isBlank(taskName)) return { ok: false, reason: "Task Name is required." };

    const frequencyCell = read("Frequency");
    const frequency = parseFrequency(frequencyCell);
    if (frequency === null) {
      return {
        ok: false,
        reason: isBlank(frequencyCell)
          ? "Frequency is required."
          : `"${frequencyCell}" is not a valid Frequency.`,
      };
    }

    const priorityCell = read("Priority");
    const priority = parsePriority(priorityCell);
    if (!isBlank(priorityCell) && priority === null) {
      return { ok: false, reason: `"${priorityCell}" is not a valid Priority.` };
    }

    const durationCell = read("Typical Duration (Days)");
    const duration = parseLegacyInt(durationCell);
    if (!isBlank(durationCell) && duration === null) {
      return {
        ok: false,
        reason: `Typical Duration (Days) must be a whole number, not "${durationCell}".`,
      };
    }

    const requiredCell = read("Required Client Input?");
    const requiresClientInput = parseYesNo(requiredCell);
    if (!isBlank(requiredCell) && requiresClientInput === null) {
      return {
        ok: false,
        reason: `Required Client Input? must be Yes or No, not "${requiredCell}".`,
      };
    }

    const activeCell = read("Active?");
    const isActive = parseYesNo(activeCell);
    if (!isBlank(activeCell) && isActive === null) {
      return {
        ok: false,
        reason: `Active? must be Yes or No, not "${activeCell}".`,
      };
    }

    return {
      ok: true,
      value: {
        displayId: parseText(read("Template ID")),
        servicePackageId,
        packageName: packageName.trim(),
        serviceArea: serviceArea.trim(),
        taskName: taskName.trim(),
        description: parseText(read("Description")),
        frequency,
        priority: priority ?? Priority.MEDIUM,
        // A ROLE, not a person (audit §6.10) — resolved per client at
        // generation time, so it is stored as the free text legacy held.
        defaultAssigneeRole: parseText(read("Default Assignee")),
        typicalDurationDays: duration ?? 0,
        requiresClientInput: requiresClientInput ?? false,
        isActive: isActive ?? true,
      },
    };
  },

  /**
   * Legacy queried templates by exact package match (audit §6.12), and each
   * package carries its own full set of rows — so the same task name in two
   * packages is two legitimate templates, not a duplicate.
   */
  dedupeKey: (value) =>
    [
      value.servicePackageId,
      value.serviceArea.toLowerCase(),
      value.taskName.toLowerCase(),
    ].join("|"),

  async existingKeys(ctx, db) {
    const templates = await db.taskTemplate.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { servicePackageId: true, serviceArea: true, taskName: true },
    });
    return new Set(
      templates.map((t) =>
        [
          t.servicePackageId,
          t.serviceArea.toLowerCase(),
          t.taskName.toLowerCase(),
        ].join("|"),
      ),
    );
  },

  async insert(ctx, db, value) {
    await db.taskTemplate.create({
      data: {
        organizationId: ctx.organizationId,
        displayId: await displayIdFor(
          ctx,
          db,
          "TASK_TEMPLATE",
          value.displayId,
        ),
        servicePackageId: value.servicePackageId,
        serviceArea: value.serviceArea,
        taskName: value.taskName,
        description: value.description,
        frequency: value.frequency,
        priority: value.priority,
        defaultAssigneeRole: value.defaultAssigneeRole,
        typicalDurationDays: value.typicalDurationDays,
        requiresClientInput: value.requiresClientInput,
        isActive: value.isActive,
      },
    });
  },

  label: (value) => `${value.packageName} · ${value.taskName}`,
};

/** Exported for the tests that assert the display-ID format survives import. */
export { formatDisplayId };
export type { Lookups };
