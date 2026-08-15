import { z } from "zod";

import { CloseStageStatus, ReviewStatus } from "@/generated/prisma/enums";
import { periodSchema } from "@/lib/validation/task";

/**
 * Monthly close validation (audit §6.13).
 *
 * A close is identified by client + period, and its display id is composite
 * (`MC-<ClientDisplayId>-<YYYYMM>`) rather than sequential, so neither is
 * accepted as input — both are derived by the service.
 *
 * Completion % and Close Status are NOT accepted either: legacy computed both
 * from the stage columns with live formulas, and CoreWorks derives them the
 * same way on every stage change.
 */

const optionalText = (max: number, label: string) =>
  z
    .union([z.literal(""), z.string().trim().max(max, `${label} is too long.`)])
    .transform((value) => (value === "" ? null : value));

export const closeStageStatusSchema = z.enum(
  Object.values(CloseStageStatus) as [CloseStageStatus, ...CloseStageStatus[]],
);

export const closeReviewStatusSchema = z.enum(
  Object.values(ReviewStatus) as [ReviewStatus, ...ReviewStatus[]],
);

/** A period is required here — a close without one has no identity. */
export const requiredPeriodSchema = z
  .string()
  .trim()
  .min(1, "Period is required.")
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the format YYYY-MM.");

export const openCloseSchema = z.object({
  clientId: z.string().uuid("Select a client."),
  period: requiredPeriodSchema,
});

export const changeStageStatusSchema = z.object({
  closeId: z.string().uuid("Invalid close."),
  stageId: z.string().uuid("Invalid stage."),
  status: closeStageStatusSchema,
});

export const updateCloseSchema = z.object({
  closeId: z.string().uuid("Invalid close."),
  reviewStatus: closeReviewStatusSchema,
  notes: optionalText(4000, "Notes"),
});

export const closeListQuerySchema = z.object({
  clientId: z.union([z.literal("ALL"), z.string().uuid()]).optional(),
  period: z.union([z.literal("ALL"), periodSchema]).optional(),
  status: z
    .union([
      z.literal("ALL"),
      z.literal("OPEN"),
      z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "CLOSED"]),
    ])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export type OpenCloseInput = z.infer<typeof openCloseSchema>;
export type CloseListQuery = z.infer<typeof closeListQuerySchema>;
