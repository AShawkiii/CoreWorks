"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateOrganizationAction,
  type FormState,
} from "@/server/actions/organization";
import type { OrganizationProfile } from "@/server/services/organization";

interface OrganizationFormProps {
  organization: OrganizationProfile;
  canEdit: boolean;
}

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
        "Save changes"
      )}
    </Button>
  );
}

export function OrganizationForm({
  organization,
  canEdit,
}: OrganizationFormProps) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateOrganizationAction,
    {},
  );

  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="name">Organization name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={organization.name}
            disabled={!canEdit}
            required
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "name-error" : undefined}
          />
          <FieldError id="name-error" message={errors.name} />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
            name="slug"
            defaultValue={organization.slug}
            disabled={!canEdit}
            required
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={errors.slug ? "slug-error" : "slug-hint"}
          />
          {errors.slug ? (
            <FieldError id="slug-error" message={errors.slug} />
          ) : (
            <p id="slug-hint" className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and hyphens. Used to identify your
              organization.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="logoUrl">Logo URL</Label>
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            placeholder="https://…"
            defaultValue={organization.logoUrl ?? ""}
            disabled={!canEdit}
            aria-invalid={errors.logoUrl ? true : undefined}
            aria-describedby={errors.logoUrl ? "logoUrl-error" : "logoUrl-hint"}
          />
          {errors.logoUrl ? (
            <FieldError id="logoUrl-error" message={errors.logoUrl} />
          ) : (
            <p id="logoUrl-hint" className="text-xs text-muted-foreground">
              Shown in the sidebar and on sign-in. Leave blank to use the
              CoreWorks mark. Direct upload arrives in Phase 12.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <Input
            id="timezone"
            name="timezone"
            defaultValue={organization.timezone}
            disabled={!canEdit}
            required
            aria-invalid={errors.timezone ? true : undefined}
            aria-describedby={errors.timezone ? "timezone-error" : undefined}
          />
          <FieldError id="timezone-error" message={errors.timezone} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            name="currency"
            maxLength={3}
            defaultValue={organization.currency}
            disabled={!canEdit}
            required
            aria-invalid={errors.currency ? true : undefined}
            aria-describedby={errors.currency ? "currency-error" : undefined}
          />
          <FieldError id="currency-error" message={errors.currency} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="locale">Locale</Label>
          <Input
            id="locale"
            name="locale"
            defaultValue={organization.locale}
            disabled={!canEdit}
            required
            aria-invalid={errors.locale ? true : undefined}
            aria-describedby={errors.locale ? "locale-error" : undefined}
          />
          <FieldError id="locale-error" message={errors.locale} />
        </div>
      </div>

      {canEdit ? (
        <div>
          <SubmitButton />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You have read-only access to organization settings.
        </p>
      )}
    </form>
  );
}
