"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { NotificationType } from "@/generated/prisma/enums";
import {
  markNotificationReadSchema,
  updateNotificationPreferencesSchema,
} from "@/lib/validation/notification";
import { ForbiddenError, requireOrgContext } from "@/server/tenancy";
import {
  markAllNotificationsRead,
  setNotificationRead,
  updateNotificationPreferences,
} from "@/server/services/notifications";

import type { FormState } from "./organization";

/**
 * Notification server actions.
 *
 * These are guarded by `requireOrgContext` rather than `requirePermission`,
 * and that is deliberate: **a notification is personal.** No role grants sight
 * of another person's, and no role is denied their own — an Owner cannot read
 * a Viewer's notifications and a Viewer needs no permission to read theirs.
 * The access boundary is the user id, applied inside the service on every
 * query, so an action here cannot widen it by forgetting a check.
 */

/** Carries a refusal back to the page it came from — see actions/tasks.ts. */
function backWithError(message: string): never {
  redirect(
    `/notifications?error=${encodeURIComponent(message.slice(0, 200))}` as Route,
  );
}

function toFormState(error: unknown): FormState {
  if (error instanceof ForbiddenError) {
    return { status: "error", message: error.message };
  }
  console.error("Unhandled notification action error:", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

/**
 * Marks one notification read or unread.
 *
 * A plain `<form action>` from a Server Component, so it returns void and
 * throws on a malformed request. There is nothing to report on success: the
 * row re-renders in its new state.
 */
export async function setNotificationReadAction(
  formData: FormData,
): Promise<void> {
  const parsed = markNotificationReadSchema.safeParse({
    notificationId: formData.get("notificationId"),
    read: formData.get("read") ?? "true",
  });
  if (!parsed.success) throw new Error("Invalid request.");

  try {
    const ctx = await requireOrgContext();
    await setNotificationRead(ctx, parsed.data.notificationId, parsed.data.read);
  } catch (error) {
    // Same treatment as the Phase 5 task actions: a refusal comes back as a
    // readable message rather than a generic 500. Reaching this needs a forged
    // id — the page only ever renders your own — but a 500 tells the person
    // nothing and looks identical to the server being broken.
    if (!(error instanceof ForbiddenError)) throw error;
    backWithError(error.message);
  }

  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const ctx = await requireOrgContext();
  await markAllNotificationsRead(ctx);
  revalidatePath("/notifications");
}

/**
 * Replaces the caller's notification preferences.
 *
 * The form posts one checkbox per configurable type; an unchecked box submits
 * nothing, so `getAll` returns exactly the enabled set and everything absent
 * is an opt-out. Reading the absent ones as "unchanged" instead would make it
 * impossible to turn anything off.
 */
export async function updateNotificationPreferencesAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requireOrgContext();

    const parsed = updateNotificationPreferencesSchema.safeParse({
      enabled: formData
        .getAll("enabled")
        .map(String)
        // Drop SYSTEM before validation rather than failing the whole form:
        // it is not rendered as a checkbox, so its presence means a crafted
        // request, and the correct response is to ignore it, not to refuse a
        // legitimate user's other choices.
        .filter((value) => value !== NotificationType.SYSTEM),
    });
    if (!parsed.success) {
      return { status: "error", message: "Invalid notification settings." };
    }

    await updateNotificationPreferences(ctx, parsed.data);

    revalidatePath("/settings/notifications");
    return { status: "success", message: "Notification settings saved." };
  } catch (error) {
    return toFormState(error);
  }
}
