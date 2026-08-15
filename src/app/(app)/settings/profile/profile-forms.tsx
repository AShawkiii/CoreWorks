"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changePasswordAction,
  updateProfileAction,
  type FormState,
} from "@/server/actions/organization";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

export function ProfileForm({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateProfileAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-name">Name</Label>
        <Input
          id="profile-name"
          name="name"
          defaultValue={name}
          required
          aria-invalid={state.fieldErrors?.name ? true : undefined}
        />
        <FieldError id="profile-name-error" message={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" value={email} disabled readOnly />
        <p className="text-xs text-muted-foreground">
          Your email is also your sign-in. Contact an administrator to change
          it.
        </p>
      </div>

      <div>
        <SubmitButton label="Save changes" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    changePasswordAction,
    {},
  );

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={errors.currentPassword ? true : undefined}
        />
        <FieldError
          id="currentPassword-error"
          message={errors.currentPassword}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.newPassword ? true : undefined}
          aria-describedby="newPassword-hint"
        />
        {errors.newPassword ? (
          <FieldError id="newPassword-error" message={errors.newPassword} />
        ) : (
          <p id="newPassword-hint" className="text-xs text-muted-foreground">
            At least 12 characters. A memorable passphrase beats a short
            complex string.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.confirmPassword ? true : undefined}
        />
        <FieldError
          id="confirmPassword-error"
          message={errors.confirmPassword}
        />
      </div>

      <div>
        <SubmitButton label="Change password" pendingLabel="Changing…" />
      </div>
    </form>
  );
}
