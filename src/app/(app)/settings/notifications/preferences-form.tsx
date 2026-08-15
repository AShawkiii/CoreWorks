"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import type { NotificationType } from "@/generated/prisma/enums";
import {
  CONFIGURABLE_NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  NOTIFICATION_TYPE_LABELS,
} from "@/lib/domain/notification";
import { updateNotificationPreferencesAction } from "@/server/actions/notifications";
import type { FormState } from "@/server/actions/organization";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        "Save preferences"
      )}
    </Button>
  );
}

/**
 * One checkbox per configurable type, all sharing the name `enabled`, so the
 * submitted set IS the enabled set and an unchecked box is the opt-out.
 *
 * `SYSTEM` is absent by construction — `CONFIGURABLE_NOTIFICATION_TYPES`
 * excludes it — rather than rendered disabled. A checkbox that cannot be
 * changed invites the reader to try, and the action rejects it server-side
 * regardless.
 */
export function NotificationPreferencesForm({
  preferences,
}: {
  preferences: Record<NotificationType, boolean>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateNotificationPreferencesAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormMessage status={state.status} message={state.message} />

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Notify me when</legend>
        {CONFIGURABLE_NOTIFICATION_TYPES.map((type) => (
          <label
            key={type}
            htmlFor={`notify-${type}`}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
          >
            <input
              id={`notify-${type}`}
              type="checkbox"
              name="enabled"
              value={type}
              defaultChecked={preferences[type]}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {NOTIFICATION_TYPE_LABELS[type]}
              </span>
              <span className="block text-sm text-muted-foreground">
                {NOTIFICATION_TYPE_DESCRIPTIONS[type]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
