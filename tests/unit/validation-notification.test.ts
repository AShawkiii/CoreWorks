import { describe, expect, it } from "vitest";

import { EntityType, NotificationType } from "@/generated/prisma/enums";
import {
  activityListQuerySchema,
  markNotificationReadSchema,
  notificationListQuerySchema,
  updateNotificationPreferencesSchema,
} from "@/lib/validation/notification";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("activityListQuerySchema", () => {
  it("defaults to page 1 with no filters", () => {
    const parsed = activityListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.clientId).toBeUndefined();
    expect(parsed.entityType).toBeUndefined();
  });

  it("accepts every entity type", () => {
    for (const entity of Object.values(EntityType)) {
      expect(
        activityListQuerySchema.safeParse({ entityType: entity }).success,
        entity,
      ).toBe(true);
    }
  });

  it("rejects an unknown entity type", () => {
    expect(
      activityListQuerySchema.safeParse({ entityType: "SPREADSHEET" }).success,
    ).toBe(false);
  });

  it("accepts SYSTEM as an actor alongside a real user id", () => {
    expect(activityListQuerySchema.parse({ userId: "SYSTEM" }).userId).toBe(
      "SYSTEM",
    );
    expect(activityListQuerySchema.parse({ userId: UUID }).userId).toBe(UUID);
    expect(
      activityListQuerySchema.safeParse({ userId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("accepts a free-text action rather than only known constants", () => {
    // Legacy wrote action names as plain strings and imported history may hold
    // values this codebase no longer emits; those rows must stay findable.
    const parsed = activityListQuerySchema.parse({
      action: "Some Legacy Action",
    });
    expect(parsed.action).toBe("Some Legacy Action");
  });

  it("parses a date range and rejects page 0", () => {
    const parsed = activityListQuerySchema.parse({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.to).toBeInstanceOf(Date);
    expect(activityListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("treats a blank date as absent rather than invalid", () => {
    const parsed = activityListQuerySchema.parse({ from: "", to: "" });
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
  });

  it("has no create, update, or delete schema", async () => {
    // The activity log is append-only, written by the services that perform
    // the change. A schema here would be the first step toward an edit path.
    const schemas = await import("@/lib/validation/notification");
    for (const name of Object.keys(schemas)) {
      expect(/activity/i.test(name) && /create|update|delete/i.test(name)).toBe(
        false,
      );
    }
  });
});

describe("notificationListQuerySchema", () => {
  it("defaults unread to false", () => {
    expect(notificationListQuerySchema.parse({}).unread).toBe(false);
  });

  it("reads unread=false as OFF, not as a truthy string", () => {
    // z.coerce.boolean() treats any non-empty string as true and would turn
    // this filter ON. The same flaw was found on three other query schemas.
    expect(notificationListQuerySchema.parse({ unread: "false" }).unread).toBe(
      false,
    );
    expect(notificationListQuerySchema.parse({ unread: "0" }).unread).toBe(
      false,
    );
    expect(notificationListQuerySchema.parse({ unread: "true" }).unread).toBe(
      true,
    );
    expect(notificationListQuerySchema.parse({ unread: "1" }).unread).toBe(true);
  });

  it("accepts every notification type and rejects an unknown one", () => {
    for (const type of Object.values(NotificationType)) {
      expect(
        notificationListQuerySchema.safeParse({ type }).success,
        type,
      ).toBe(true);
    }
    expect(
      notificationListQuerySchema.safeParse({ type: "EMAIL" }).success,
    ).toBe(false);
  });
});

describe("markNotificationReadSchema", () => {
  it("defaults to marking read", () => {
    expect(
      markNotificationReadSchema.parse({ notificationId: UUID }).read,
    ).toBe(true);
  });

  it("reads an explicit false as unread, so a misclick is recoverable", () => {
    expect(
      markNotificationReadSchema.parse({ notificationId: UUID, read: "false" })
        .read,
    ).toBe(false);
    expect(
      markNotificationReadSchema.parse({ notificationId: UUID, read: "0" }).read,
    ).toBe(false);
  });

  it("rejects a malformed id", () => {
    expect(
      markNotificationReadSchema.safeParse({ notificationId: "nope" }).success,
    ).toBe(false);
  });
});

describe("updateNotificationPreferencesSchema", () => {
  it("accepts an empty set — everything muted", () => {
    expect(updateNotificationPreferencesSchema.parse({ enabled: [] })).toEqual({
      enabled: [],
    });
  });

  it("accepts every configurable type", () => {
    const configurable = Object.values(NotificationType).filter(
      (type) => type !== NotificationType.SYSTEM,
    );
    expect(
      updateNotificationPreferencesSchema.safeParse({ enabled: configurable })
        .success,
    ).toBe(true);
  });

  it("refuses SYSTEM — it is not user-configurable", () => {
    expect(
      updateNotificationPreferencesSchema.safeParse({
        enabled: [NotificationType.SYSTEM],
      }).success,
    ).toBe(false);
  });

  it("refuses an unknown type", () => {
    expect(
      updateNotificationPreferencesSchema.safeParse({ enabled: ["EMAIL_ME"] })
        .success,
    ).toBe(false);
  });
});
