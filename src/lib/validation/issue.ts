import { z } from "zod";

import { IssueSeverity, IssueStatus } from "@/generated/prisma/enums";
import { optionalDateSchema } from "@/lib/validation/client";

/**
 * Issue validation (master prompt §13/§37).
 *
 * Legacy `createIssue` requires exactly two fields — Client ID and Issue
 * (audit §6.5, `IssueService.gs:7`) — and defaults Status to Open and Date
 * Raised to today. Both defaults live in the service, not here, so a caller
 * that bypasses the form still gets them.
 *
 * Severity is NOT a required field in legacy; the schema defaults it to
 * Medium rather than forcing a choice, matching the sheet's behaviour where
 * an unset severity fell through to the enum's middle value.
 */

const optionalText = (max: number, label: string) =>
  z
    .union([z.literal(""), z.string().trim().max(max, `${label} is too long.`)])
    .transform((value) => (value === "" ? null : value));

export const issueSeveritySchema = z.enum(
  Object.values(IssueSeverity) as [IssueSeverity, ...IssueSeverity[]],
);

export const issueStatusSchema = z.enum(
  Object.values(IssueStatus) as [IssueStatus, ...IssueStatus[]],
);

const memberIdSchema = z
  .union([z.literal(""), z.string().uuid("Select a valid team member.")])
  .transform((value) => (value === "" ? null : value));

const baseIssueFields = {
  clientId: z.string().uuid("Select a client."),
  title: z
    .string()
    .trim()
    .min(2, "Issue must be at least 2 characters.")
    .max(200, "Issue is too long."),
  category: optionalText(80, "Category"),
  /** Legacy ISSUES."Impact" — retained per audit conflict C3. */
  impact: optionalText(2000, "Impact"),
  description: optionalText(4000, "Description"),
  severity: issueSeveritySchema,
  assignedToId: memberIdSchema,
  dateRaised: optionalDateSchema,
  deadline: optionalDateSchema,
  requiredAction: optionalText(2000, "Required action"),
  notes: optionalText(4000, "Notes"),
};

export const createIssueSchema = z.object(baseIssueFields);

export const updateIssueSchema = z.object({
  issueId: z.string().uuid("Invalid issue."),
  ...baseIssueFields,
});

/**
 * A status change is its own action.
 *
 * Legacy `resolveIssue` was a distinct operation with side effects — it
 * stamps a Resolution Date and logs a separate activity entry — so it is not
 * folded into a general field update. `resolutionDate` is accepted because
 * legacy accepted one (`resolveIssue(issueId, resolutionDate)`), defaulting
 * to today when absent.
 */
export const changeIssueStatusSchema = z.object({
  issueId: z.string().uuid("Invalid issue."),
  status: issueStatusSchema,
  // `.optional()` as well as empty-string-tolerant: a bare status button posts
  // neither field, and an absent key is not an invalid one.
  resolutionDate: optionalDateSchema.optional(),
  resolution: optionalText(4000, "Resolution").optional(),
});

export const issueListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  clientId: z.union([z.literal("ALL"), z.string().uuid()]).optional(),
  status: z
    .union([z.literal("ALL"), z.literal("OPEN"), issueStatusSchema])
    .optional(),
  severity: z.union([z.literal("ALL"), issueSeveritySchema]).optional(),
  assignedToId: z
    .union([z.literal("ALL"), z.literal("UNASSIGNED"), z.string().uuid()])
    .optional(),
  /**
   * "Needing attention" — legacy `selectSurfacedIssues`. A derived condition,
   * not a stored column; see the service.
   *
   * Parsed by explicit token rather than `z.coerce.boolean()`, which treats
   * any non-empty string as true and would read `?surfaced=false` as ON.
   */
  surfaced: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true" || value === "1",
    ),
  sort: z
    .enum(["severity", "raised", "deadline", "client", "status"])
    .optional()
    .default("severity"),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
export type IssueListQuery = z.infer<typeof issueListQuerySchema>;
