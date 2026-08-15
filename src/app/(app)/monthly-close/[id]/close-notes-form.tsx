"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ReviewStatus } from "@/generated/prisma/enums";
import { REVIEW_STATUS_LABELS } from "@/lib/domain/labels";
import { updateCloseAction } from "@/server/actions/monthly-close";
import type { FormState } from "@/server/actions/organization";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        "Save"
      )}
    </Button>
  );
}

/**
 * Review status and notes.
 *
 * Deliberately separate from the stage board: Close Status and Completion %
 * are derived from the stages and are never edited directly, exactly as
 * legacy's live formulas made them read-only.
 */
export function CloseNotesForm({
  closeId,
  reviewStatus,
  notes,
}: {
  closeId: string;
  reviewStatus: ReviewStatus;
  notes: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateCloseAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="closeId" value={closeId} />

      <FormMessage status={state.status} message={state.message} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="close-reviewStatus">Review status</Label>
        <Select
          id="close-reviewStatus"
          name="reviewStatus"
          defaultValue={reviewStatus}
        >
          {Object.values(ReviewStatus).map((status) => (
            <option key={status} value={status}>
              {REVIEW_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="close-notes">Notes</Label>
        <textarea
          id="close-notes"
          name="notes"
          rows={4}
          defaultValue={notes}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
