import { z } from "zod";

import {
  ContractStatus,
  Priority,
  ReportingFrequency,
} from "@/generated/prisma/enums";

/**
 * Client validation (master prompt §10/§37).
 *
 * The four required fields are legacy's, unchanged: Client Name, Service
 * Package, Account Manager, and Start Date (audit §6.9). Start Date is absent
 * from the CoreWorks brief's field list but required by the legacy rule —
 * audit conflict C2 — so it is required here too.
 */

const optionalText = (max: number, label: string) =>
  z
    .union([z.literal(""), z.string().trim().max(max, `${label} is too long.`)])
    .transform((value) => (value === "" ? null : value));

export const contractStatusSchema = z.enum(
  Object.values(ContractStatus) as [ContractStatus, ...ContractStatus[]],
);

export const prioritySchema = z.enum(
  Object.values(Priority) as [Priority, ...Priority[]],
);

export const reportingFrequencySchema = z
  .union([
    z.literal(""),
    z.enum(
      Object.values(ReportingFrequency) as [
        ReportingFrequency,
        ...ReportingFrequency[],
      ],
    ),
  ])
  .transform((value) => (value === "" ? null : value));

/** Accepts an `<input type="date">` value and normalises to local midnight. */
export const dateSchema = z
  .string()
  .trim()
  .min(1, "Date is required.")
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
  .transform((value, ctx) => {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date." });
      return z.NEVER;
    }
    return date;
  });

export const optionalDateSchema = z
  .union([z.literal(""), dateSchema])
  .transform((value) => (value === "" ? null : (value as Date)));

/** Day of the month a client's books close. */
export const monthEndClosingDaySchema = z
  .union([
    z.literal(""),
    z.coerce
      .number()
      .int("Enter a whole day of the month.")
      .min(1, "Day must be between 1 and 31.")
      .max(31, "Day must be between 1 and 31."),
  ])
  .transform((value) => (value === "" ? null : value));

const uuidOrEmpty = (label: string) =>
  z
    .union([z.literal(""), z.string().uuid(`Select a valid ${label}.`)])
    .transform((value) => (value === "" ? null : value));

const baseClientFields = {
  name: z
    .string()
    .trim()
    .min(2, "Client name must be at least 2 characters.")
    .max(120, "Client name is too long."),
  companyName: optionalText(160, "Company name"),
  industry: optionalText(80, "Industry"),
  businessType: optionalText(80, "Business type"),
  // Required — legacy rule, audit conflict C2.
  startDate: dateSchema,
  servicePackageId: z.string().uuid("Select a service package."),
  accountManagerId: z.string().uuid("Select an account manager."),
  backupMemberId: uuidOrEmpty("team member"),
  contactName: optionalText(120, "Contact name"),
  email: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email.")])
    .transform((value) => (value === "" ? null : value.toLowerCase())),
  phone: optionalText(40, "Phone"),
  accountingSystem: optionalText(80, "Accounting system"),
  reportingFrequency: reportingFrequencySchema,
  monthEndClosingDay: monthEndClosingDaySchema,
  contractStatus: contractStatusSchema,
  priority: prioritySchema,
  notes: optionalText(4000, "Notes"),
};

export const createClientSchema = z.object(baseClientFields);

export const updateClientSchema = z.object({
  clientId: z.string().uuid("Invalid client."),
  ...baseClientFields,
});

export const archiveClientSchema = z.object({
  clientId: z.string().uuid("Invalid client."),
  archived: z.boolean(),
});

/** Contacts (master prompt §67 — a client may have more than one). */
export const clientContactSchema = z.object({
  clientId: z.string().uuid("Invalid client."),
  contactId: z.union([z.literal(""), z.string().uuid()]).optional(),
  name: z
    .string()
    .trim()
    .min(2, "Contact name must be at least 2 characters.")
    .max(120, "Contact name is too long."),
  role: optionalText(80, "Role"),
  email: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email.")])
    .transform((value) => (value === "" ? null : value.toLowerCase())),
  phone: optionalText(40, "Phone"),
  isPrimary: z.boolean().optional().default(false),
});

export const deleteClientContactSchema = z.object({
  clientId: z.string().uuid("Invalid client."),
  contactId: z.string().uuid("Invalid contact."),
});

/** Client list query — filters, search, sort, pagination (master prompt §10/§47). */
export const clientListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.union([z.literal("ALL"), contractStatusSchema]).optional(),
  health: z
    .union([z.literal("ALL"), z.enum(["ON_TRACK", "AT_RISK", "DELAYED", "ON_HOLD"])])
    .optional(),
  accountManagerId: z.union([z.literal("ALL"), z.string().uuid()]).optional(),
  sort: z
    .enum(["health", "name", "completion", "nextDeadline"])
    .optional()
    .default("health"),
  page: z.coerce.number().int().min(1).optional().default(1),
  /**
   * Parsed by explicit token rather than `z.coerce.boolean()`, which treats
   * any non-empty string as true and would read `?includeArchived=false` as
   * ON — surfacing archived clients on a URL that says not to.
   */
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true" || value === "1",
    ),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ClientContactInput = z.infer<typeof clientContactSchema>;
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
