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
import { Priority, ReviewStatus } from "@/generated/prisma/enums";
import { PRIORITY_LABELS, REVIEW_STATUS_LABELS } from "@/lib/domain/labels";
import { createTaskAction, updateTaskAction } from "@/server/actions/tasks";
import type { FormState } from "@/server/actions/organization";

export interface TaskFormValues {
  taskId?: string;
  clientId: string;
  taskName: string;
  serviceArea: string;
  description: string;
  period: string;
  assignedToId: string;
  reviewerId: string;
  priority: Priority;
  dueDate: string;
  startDate: string;
  reviewStatus: ReviewStatus;
  clientDependency: boolean;
  waitingFor: string;
  notes: string;
}

interface TaskFormProps {
  mode: "create" | "edit";
  values: TaskFormValues;
  clients: { id: string; name: string; displayId: string }[];
  members: { id: string; name: string }[];
  serviceAreas: string[];
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {mode === "create" ? "Creating…" : "Saving…"}
        </>
      ) : mode === "create" ? (
        "Create task"
      ) : (
        "Save changes"
      )}
    </Button>
  );
}

export function TaskForm({
  mode,
  values,
  clients,
  members,
  serviceAreas,
}: TaskFormProps) {
  const action = mode === "create" ? createTaskAction : updateTaskAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {values.taskId ? (
        <input type="hidden" name="taskId" value={values.taskId} />
      ) : null}

      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="taskName">Task name</Label>
          <Input
            id="taskName"
            name="taskName"
            defaultValue={values.taskName}
            required
            aria-invalid={errors.taskName ? true : undefined}
          />
          <FieldError id="taskName-error" message={errors.taskName} />
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
          <Label htmlFor="serviceArea">Service area</Label>
          <Input
            id="serviceArea"
            name="serviceArea"
            list="service-areas"
            defaultValue={values.serviceArea}
            required
            aria-invalid={errors.serviceArea ? true : undefined}
          />
          {/* A datalist rather than a select: service areas are free text in
              legacy, so an existing value should be easy to reuse without
              preventing a new one. */}
          <datalist id="service-areas">
            {serviceAreas.map((area) => (
              <option key={area} value={area} />
            ))}
          </datalist>
          <FieldError id="serviceArea-error" message={errors.serviceArea} />
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
          <Label htmlFor="reviewerId">Reviewer</Label>
          <Select
            id="reviewerId"
            name="reviewerId"
            defaultValue={values.reviewerId}
          >
            <option value="">None</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" name="priority" defaultValue={values.priority}>
            {Object.values(Priority).map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Drives weighted completion: Critical counts four times Low.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reviewStatus">Review status</Label>
          <Select
            id="reviewStatus"
            name="reviewStatus"
            defaultValue={values.reviewStatus}
          >
            {Object.values(ReviewStatus).map((status) => (
              <option key={status} value={status}>
                {REVIEW_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={values.startDate}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dueDate">Due date</Label>
          <Input
            id="dueDate"
            name="dueDate"
            type="date"
            defaultValue={values.dueDate}
            aria-invalid={errors.dueDate ? true : undefined}
          />
          <FieldError id="dueDate-error" message={errors.dueDate} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="period">Period</Label>
          <Input
            id="period"
            name="period"
            placeholder="2026-08"
            defaultValue={values.period}
            aria-invalid={errors.period ? true : undefined}
          />
          {errors.period ? (
            <FieldError id="period-error" message={errors.period} />
          ) : (
            <p className="text-xs text-muted-foreground">
              YYYY-MM. Used to group recurring work and prevent duplicate
              generation.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waitingFor">Waiting for</Label>
          <Input
            id="waitingFor"
            name="waitingFor"
            defaultValue={values.waitingFor}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="clientDependency"
          defaultChecked={values.clientDependency}
          className="size-4 rounded border-input accent-primary"
        />
        This task depends on the client providing something
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={values.description}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={values.notes}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton mode={mode} />
        <Link
          href={values.taskId ? `/tasks/${values.taskId}` : "/tasks"}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
      </div>

      {mode === "edit" ? (
        <p className="text-xs text-muted-foreground">
          Status is changed from the task page, not here — moving a task
          through its lifecycle has side effects that a field edit should not
          trigger.
        </p>
      ) : null}
    </form>
  );
}
