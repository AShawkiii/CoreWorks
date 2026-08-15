import { z } from "zod";

import { EntityType, NotificationType } from "@/generated/prisma/enums";
import { optionalDateSchema } from "@/lib/validation/client";

/**
 * Activity Log and Notification validation.
 *
 * The activity log is READ-ONLY. There is no create, edit, or delete schema
 * here and there must never be one: an audit trail a user can rewrite is not
 * an audit trail. Entries are written exclusively by
 * `src/server/services/activity.ts`, called from the services that perform the
 * change being recorded.
 */

export const entityTypeSchema = z.enum(
  Object.values(EntityType) as [EntityType, ...EntityType[]],
);

export const notificationTypeSchema = z.enum(
  Object.values(NotificationType) as [NotificationType, ...NotificationType[]],
);

/**
 * Activity feed filters.
 *
 * `action` is a free-text match rather than an enum. Legacy wrote action names
 * as plain strings (`ActivityLogger.gs`), and imported history may hold values
 * that no longer appear in `ACTIVITY_ACTIONS`. Constraining the filter to
 * today's constants would make those rows unfindable.
 */
export const activityListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  clientId: z.union([z.literal("ALL"), z.string().uuid()]).optional(),
  entityType: z.union([z.literal("ALL"), entityTypeSchema]).optional(),
  action: z.union([z.literal("ALL"), z.string().trim().max(80)]).optional(),
  /**
   * Filters by the acting USER id. Scheduled runs have none, so `SYSTEM` is
   * offered as its own token — see `systemContext` in `server/context.ts`.
   */
  userId: z
    .union([z.literal("ALL"), z.literal("SYSTEM"), z.string().uuid()])
    .optional(),
  from: optionalDateSchema.optional(),
  to: optionalDateSchema.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
});

/**
 * Notification feed filters.
 *
 * `unread` is parsed by explicit token, not `z.coerce.boolean()`, which reads
 * any non-empty string as true and would turn `?unread=false` ON. The same
 * flaw was found and fixed on three other query schemas (Phases 5 and 7).
 */
export const notificationListQuerySchema = z.object({
  unread: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true" || value === "1",
    ),
  type: z.union([z.literal("ALL"), notificationTypeSchema]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid("Invalid notification."),
  /** False re-opens it, so a misclick is recoverable. */
  read: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      typeof value === "boolean" ? value : value !== "false" && value !== "0",
    ),
});

/**
 * Preference update.
 *
 * The form posts the types that are ENABLED — an unchecked box submits
 * nothing, so the absent ones are the opt-outs. `type` is validated per entry
 * so an unknown string cannot reach the database, and `SYSTEM` is rejected
 * because it is not user-configurable (see `CONFIGURABLE_NOTIFICATION_TYPES`).
 */
export const updateNotificationPreferencesSchema = z.object({
  enabled: z
    .array(
      notificationTypeSchema.refine(
        (type) => type !== NotificationType.SYSTEM,
        "System notices cannot be turned off.",
      ),
    )
    .max(Object.values(NotificationType).length),
});

export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;
