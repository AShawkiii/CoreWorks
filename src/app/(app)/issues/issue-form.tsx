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
import { IssueSeverity } from "@/generated/prisma/enums";
import { ISSUE_SEVERITY_LABELS } from "@/lib/domain/labels";
import { createIssueAction, updateIssueAction } from "@/server/actions/issues";
import type { FormState } from "@/server/actions/organization";

const TEXTAREA_CLASS =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export interface IssueFormValues {
  issueId?: string;
  clientId: string;
  title: string;
  category: string;
  impact: string;
  description: string;
  severity: IssueSeverity;
  assignedToId: string;
  dateRaised: string;
  deadline: string;
  requiredAction: string;
  notes: string;
}

interface IssueFormProps {
  mode: "create" | "edit";
  values: IssueFormValues;
  clients: { id: string; name: string; displayId: string }[];
  members: { id: string; name: string }[];
  categories: string[];
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
        "Raise issue"
      ) : (
        "Save changes"
      )}
    </Button>
  );
}

export function IssueForm({
  mode,
  values,
  clients,
  members,
  categories,
}: IssueFormProps) {
  const action = mode === "create" ? createIssueAction : updateIssueAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {values.issueId ? (
        <input type="hidden" name="issueId" value={values.issueId} />
      ) : null}

      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="title">Issue</Label>
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
          <Label htmlFor="category">Category</Label>
          {/* Free text in legacy, so a datalist rather than a select: reuse an
              existing category easily without preventing a new one. */}
          <Input
            id="category"
            name="category"
            list="issue-categories"
            defaultValue={values.category}
          />
          <datalist id="issue-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="severity">Severity</Label>
          <Select
            id="severity"
            name="severity"
            defaultValue={values.severity}
            required
          >
            {Object.values(IssueSeverity).map((severity) => (
              <option key={severity} value={severity}>
                {ISSUE_SEVERITY_LABELS[severity]}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            An open Critical issue puts the client at Delayed; an open High
            puts them At Risk.
          </p>
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
          <Label htmlFor="dateRaised">Date raised</Label>
          <Input
            id="dateRaised"
            name="dateRaised"
            type="date"
            defaultValue={values.dateRaised}
          />
          <p className="text-xs text-muted-foreground">
            Defaults to today when left blank.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="deadline">Deadline</Label>
          <Input
            id="deadline"
            name="deadline"
            type="date"
            defaultValue={values.deadline}
          />
          <p className="text-xs text-muted-foreground">
            An open issue past its deadline needs attention regardless of
            severity.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="impact">Impact</Label>
        <textarea
          id="impact"
          name="impact"
          rows={2}
          defaultValue={values.impact}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="requiredAction">Required action</Label>
        <textarea
          id="requiredAction"
          name="requiredAction"
          rows={2}
          defaultValue={values.requiredAction}
          className={TEXTAREA_CLASS}
        />
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
          href={values.issueId ? `/issues/${values.issueId}` : "/issues"}
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
      </div>

      {mode === "edit" ? (
        <p className="text-xs text-muted-foreground">
          Status is changed from the issue page, not here — resolving an issue
          stamps a resolution date and logs its own entry.
        </p>
      ) : null}
    </form>
  );
}
