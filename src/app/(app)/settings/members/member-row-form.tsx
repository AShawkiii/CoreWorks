"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import type { FormState } from "@/server/actions/organization";
import { updateMemberAction } from "@/server/actions/members";
import type { MemberListItem } from "@/server/services/members";
import type { OrgRole } from "@/generated/prisma/enums";

interface MemberRowFormProps {
  member: MemberListItem;
  assignableRoles: OrgRole[];
  onDone: () => void;
}

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

export function MemberRowForm({
  member,
  assignableRoles,
  onDone,
}: MemberRowFormProps) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateMemberAction,
    {},
  );

  const errors = state.fieldErrors ?? {};
  const fieldId = (name: string) => `${name}-${member.id}`;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="memberId" value={member.id} />

      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("name")}>Name</Label>
          <Input
            id={fieldId("name")}
            name="name"
            defaultValue={member.name}
            required
            aria-invalid={errors.name ? true : undefined}
          />
          <FieldError id={`${fieldId("name")}-error`} message={errors.name} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("role")}>Access role</Label>
          <Select
            id={fieldId("role")}
            name="role"
            defaultValue={member.role}
            aria-invalid={errors.role ? true : undefined}
          >
            {assignableRoles.map((role) => (
              <option key={role} value={role}>
                {ORG_ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          <FieldError id={`${fieldId("role")}-error`} message={errors.role} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("jobTitle")}>Job title</Label>
          <Input
            id={fieldId("jobTitle")}
            name="jobTitle"
            defaultValue={member.jobTitle ?? ""}
            placeholder="Senior Accountant"
            aria-describedby={`${fieldId("jobTitle")}-hint`}
          />
          <p
            id={`${fieldId("jobTitle")}-hint`}
            className="text-xs text-muted-foreground"
          >
            Used to assign work from task templates. Not an access role.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("department")}>Department</Label>
          <Input
            id={fieldId("department")}
            name="department"
            defaultValue={member.department ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("capacity")}>Capacity</Label>
          <Input
            id={fieldId("capacity")}
            name="capacity"
            type="number"
            min={0}
            step={1}
            defaultValue={member.capacity ?? ""}
            aria-invalid={errors.capacity ? true : undefined}
            aria-describedby={`${fieldId("capacity")}-hint`}
          />
          {errors.capacity ? (
            <FieldError
              id={`${fieldId("capacity")}-error`}
              message={errors.capacity}
            />
          ) : (
            <p
              id={`${fieldId("capacity")}-hint`}
              className="text-xs text-muted-foreground"
            >
              Open tasks above this count flag the member as overloaded. Leave
              blank for no limit.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SaveButton />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
