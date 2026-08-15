import { z } from "zod";

import { Priority, RequestStatus } from "@/generated/prisma/enums";
import { optionalDateSchema } from "@/lib/validation/client";

/**
 * Client request validation (master prompt §13/§37).
 *
 * Legacy `createClientRequest` requires exactly two fields — Client ID and
 * Request (audit §6.8, `ClientRequestService.gs:7`) — and defaults Status to
 * Requested and Requested Date to today. Both defaults live in the service.
 *
 * Days Waiting and its bucket are NOT accepted here. Legacy read them from a
 * live ARRAYFORMULA column; CoreWorks derives them on read, so there is
 * nothing to submit and nothing to go stale.
 */

const optionalText = (max: number, label: string) =>
  z
    .union([z.literal(""), z.string().trim().max(max, `${label} is too long.`)])
    .transform((value) => (value === "" ? null : value));

export const requestStatusSchema = z.enum(
  Object.values(RequestStatus) as [RequestStatus, ...RequestStatus[]],
);

export const requestPrioritySchema = z.enum(
  Object.values(Priority) as [Priority, ...Priority[]],
);

const memberIdSchema = z
  .union([z.literal(""), z.string().uuid("Select a valid team member.")])
  .transform((value) => (value === "" ? null : value));

const baseRequestFields = {
  clientId: z.string().uuid("Select a client."),
  title: z
    .string()
    .trim()
    .min(2, "Request must be at least 2 characters.")
    .max(200, "Request is too long."),
  description: optionalText(4000, "Description"),
  priority: requestPrioritySchema,
  assignedToId: memberIdSchema,
  requestedDate: optionalDateSchema,
  requiredBy: optionalDateSchema,
  notes: optionalText(4000, "Notes"),
};

export const createRequestSchema = z.object(baseRequestFields);

export const updateRequestSchema = z.object({
  requestId: z.string().uuid("Invalid request."),
  ...baseRequestFields,
});

/**
 * A status change is its own action.
 *
 * Legacy `updateRequestStatus` stamps Received Date when — and only when —
 * the new status is Received, defaulting to today unless one is supplied.
 * That stamp is what freezes Days Waiting, so it cannot be a side effect of
 * a general field edit.
 */
export const changeRequestStatusSchema = z.object({
  requestId: z.string().uuid("Invalid request."),
  status: requestStatusSchema,
  // `.optional()` as well as empty-string-tolerant: a bare status button posts
  // neither field, and an absent key is not an invalid one.
  receivedDate: optionalDateSchema.optional(),
  resolution: optionalText(4000, "Resolution").optional(),
});

export const requestListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  clientId: z.union([z.literal("ALL"), z.string().uuid()]).optional(),
  status: z
    .union([z.literal("ALL"), z.literal("OPEN"), requestStatusSchema])
    .optional(),
  priority: z.union([z.literal("ALL"), requestPrioritySchema]).optional(),
  assignedToId: z
    .union([z.literal("ALL"), z.literal("UNASSIGNED"), z.string().uuid()])
    .optional(),
  /**
   * Stale — open and waiting at or beyond the organization's threshold
   * (legacy `flagStaleRequests`, default 15 days). Derived, not stored.
   *
   * Explicit-token parsing, for the same reason as the issue `surfaced` flag.
   */
  stale: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true" || value === "1",
    ),
  sort: z
    .enum(["waiting", "requested", "requiredBy", "priority", "client", "status"])
    .optional()
    .default("waiting"),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;
