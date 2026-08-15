"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { OrgRole } from "@/generated/prisma/enums";
import { ORG_ROLE_LABELS } from "@/lib/domain/labels";
import { inviteMemberAction } from "@/server/actions/members";
import type { FormState } from "@/server/actions/organization";

interface InviteMemberFormProps {
  assignableRoles: OrgRole[];
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Adding…
        </>
      ) : (
        "Add member"
      )}
    </Button>
  );
}

export function InviteMemberForm({ assignableRoles }: InviteMemberFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<FormState, FormData>(
    inviteMemberAction,
    {},
  );

  const errors = state.fieldErrors ?? {};

  if (!open) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage status={state.status} message={state.message} />
        <div>
          <Button onClick={() => setOpen(true)} size="sm">
            <UserPlus aria-hidden="true" />
            Add member
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4"
      noValidate
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Add a member</h3>
      </div>

      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-name">Name</Label>
          <Input id="invite-name" name="name" required autoComplete="off" />
          <FieldError id="invite-name-error" message={errors.name} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
          />
          <FieldError id="invite-email-error" message={errors.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-password">Temporary password</Label>
          <Input
            id="invite-password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            aria-describedby="invite-password-hint"
          />
          {errors.password ? (
            <FieldError id="invite-password-error" message={errors.password} />
          ) : (
            <p id="invite-password-hint" className="text-xs text-muted-foreground">
              At least 12 characters. Share it securely; they can change it
              from their profile. Email invitations arrive in Phase 11.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-role">Access role</Label>
          <Select id="invite-role" name="role" defaultValue="TEAM_MEMBER">
            {assignableRoles.map((role) => (
              <option key={role} value={role}>
                {ORG_ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          <FieldError id="invite-role-error" message={errors.role} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-jobTitle">Job title</Label>
          <Input
            id="invite-jobTitle"
            name="jobTitle"
            placeholder="Bookkeeper"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-department">Department</Label>
          <Input id="invite-department" name="department" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-capacity">Capacity</Label>
          <Input
            id="invite-capacity"
            name="capacity"
            type="number"
            min={0}
            step={1}
          />
          <FieldError id="invite-capacity-error" message={errors.capacity} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton />
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
