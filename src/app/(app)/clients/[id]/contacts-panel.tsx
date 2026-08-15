"use client";

import { Loader2, Plus, Star, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteClientContactAction,
  saveClientContactAction,
} from "@/server/actions/clients";
import type { FormState } from "@/server/actions/organization";

interface Contact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

interface ContactsPanelProps {
  clientId: string;
  contacts: Contact[];
  canEdit: boolean;
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
        "Save contact"
      )}
    </Button>
  );
}

export function ContactsPanel({
  clientId,
  contacts,
  canEdit,
}: ContactsPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [state, formAction] = useActionState<FormState, FormData>(
    saveClientContactAction,
    {},
  );

  const errors = state.fieldErrors ?? {};

  const form = (contact?: Contact) => (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4"
      noValidate
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="contactId" value={contact?.id ?? ""} />

      <FormMessage status={state.status} message={state.message} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`contact-name-${contact?.id ?? "new"}`}>Name</Label>
          <Input
            id={`contact-name-${contact?.id ?? "new"}`}
            name="name"
            defaultValue={contact?.name ?? ""}
            required
            aria-invalid={errors.name ? true : undefined}
          />
          <FieldError id="contact-name-error" message={errors.name} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`contact-role-${contact?.id ?? "new"}`}>Role</Label>
          <Input
            id={`contact-role-${contact?.id ?? "new"}`}
            name="role"
            defaultValue={contact?.role ?? ""}
            placeholder="Finance Director"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`contact-email-${contact?.id ?? "new"}`}>Email</Label>
          <Input
            id={`contact-email-${contact?.id ?? "new"}`}
            name="email"
            type="email"
            defaultValue={contact?.email ?? ""}
            aria-invalid={errors.email ? true : undefined}
          />
          <FieldError id="contact-email-error" message={errors.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`contact-phone-${contact?.id ?? "new"}`}>Phone</Label>
          <Input
            id={`contact-phone-${contact?.id ?? "new"}`}
            name="phone"
            defaultValue={contact?.phone ?? ""}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="isPrimary"
          defaultChecked={contact?.isPrimary ?? false}
          className="size-4 rounded border-input accent-primary"
        />
        Primary contact
      </label>

      <div className="flex items-center gap-2">
        <SaveButton />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(null);
            setAdding(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-4">
      {contacts.length === 0 && !adding ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No additional contacts recorded.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {contacts.map((contact) =>
            editing === contact.id ? (
              <li key={contact.id}>{form(contact)}</li>
            ) : (
              <li
                key={contact.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {contact.name}
                    {contact.isPrimary ? (
                      <Badge variant="primary">
                        <Star className="size-3" aria-hidden="true" />
                        Primary
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[contact.role, contact.email, contact.phone]
                      .filter(Boolean)
                      .join(" · ") || "No details recorded"}
                  </p>
                </div>

                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(contact.id)}
                    >
                      Edit
                    </Button>
                    <form action={deleteClientContactAction}>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="contactId" value={contact.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                      >
                        <Trash2 aria-hidden="true" />
                        <span className="sr-only">Remove {contact.name}</span>
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}

      {canEdit ? (
        adding ? (
          form()
        ) : (
          <div>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Add contact
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
