"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button, buttonVariants } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Priority } from "@/generated/prisma/enums";
import { PRIORITY_LABELS } from "@/lib/domain/labels";
import {
  createRequestAction,
  updateRequestAction,
} from "@/server/actions/requests";
import type { FormState } from "@/server/actions/organization";

const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export interface RequestFormValues {
  requestId?: string;
  clientId: string;
  title: string;
  description: string;
  priority: Priority;
  assignedToId: string;
  requestedDate: string;
  requiredBy: string;
  notes: string;
}

interface RequestFormProps {
  mode: "create" | "edit";
  values: RequestFormValues;
  clients: { id: string; name: string; displayId: string }[];
  members: { id: string; name: string }[];
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {mode === "create" ? "Raising…" : "Saving…"}
        </>
      ) : mode === "create" ? (
        "Raise request"
      ) : (
        "Save changes"
      )}
    </Button>
  );
}

export function RequestForm({
  mode,
  values,
  clients,
  members,
}: RequestFormProps) {
  const action = mode === "create" ? createRequestAction : updateRequestAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {values.requestId ? (
        <input type="hidden" name="requestId" value={values.requestId} />
      ) : null}

      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="title">Request</Label>
          <Input
            id="title"
            name="title"
            defaultValue={values.title}
            required
            aria-invalid={errors.title ? true : undefined}
          />
          <FieldError id="title-error" message={errors.title} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="clientId">Client</Label>
          <Select
            id="clientId"
            name="clientId"
            defaultValue={values.clientId}
            required
            aria-invalid={errors.clientId ? true : undefined}
          >
            <option value="">Select a client…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name} ({client.displayId})
              </option>
            ))}
          </Select>
          <FieldError id="clientId-error" message={errors.clientId} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select
            id="priority"
            name="priority"
            defaultValue={values.priority}
            required
          >
            {Object.values(Priority).map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="assignedToId">Assigned to</Label>
          <Select
            id="assignedToId"
            name="assignedToId"
            defaultValue={values.assignedToId}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="requestedDate">Requested date</Label>
          <Input
            id="requestedDate"
            name="requestedDate"
            type="date"
            defaultValue={values.requestedDate}
          />
          <p className="text-xs text-muted-foreground">
            Days waiting counts from this date. Defaults to today when blank.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="requiredBy">Required by</Label>
          <Input
            id="requiredBy"
            name="requiredBy"
            type="date"
            defaultValue={values.requiredBy}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={values.description}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={values.notes}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton mode={mode} />
        <Link
          href={values.requestId ? `/requests/${values.requestId}` : "/requests"}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
      </div>

      {mode === "edit" ? (
        <p className="text-xs text-muted-foreground">
          Status is changed from the request page, not here — marking a request
          Received stamps the date that stops the waiting clock.
        </p>
      ) : null}
    </form>
  );
}
