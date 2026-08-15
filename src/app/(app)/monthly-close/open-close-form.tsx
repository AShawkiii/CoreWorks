"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { openCloseAction } from "@/server/actions/monthly-close";
import type { FormState } from "@/server/actions/organization";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Opening…
        </>
      ) : (
        "Open close"
      )}
    </Button>
  );
}

/**
 * Opens a close for a client and period.
 *
 * Pressing it for a client+period that already has a close simply goes to it:
 * the period is unique per client, as legacy's one-row-per-client-per-month
 * sheet was, so there is nothing to duplicate.
 */
export function OpenCloseForm({
  clients,
  defaultPeriod,
}: {
  clients: { id: string; name: string; displayId: string }[];
  defaultPeriod: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    openCloseAction,
    {},
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="close-clientId">Client</Label>
          <Select id="close-clientId" name="clientId" required defaultValue="">
            <option value="">Select a client…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.displayId})
              </option>
            ))}
          </Select>
          <FieldError id="close-clientId-error" message={errors.clientId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="close-period">Period</Label>
          <Input
            id="close-period"
            name="period"
            placeholder="YYYY-MM"
            defaultValue={defaultPeriod}
            required
          />
          <FieldError id="close-period-error" message={errors.period} />
        </div>
      </div>

      <div>
        <SubmitButton />
      </div>

      <p className="text-xs text-muted-foreground">
        All eighteen close stages are created at once, so completion is always
        out of eighteen.
      </p>
    </form>
  );
}
