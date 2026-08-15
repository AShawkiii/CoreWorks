"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  forgotPasswordAction,
  type ForgotPasswordState,
} from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Sending…
        </>
      ) : (
        "Send reset link"
      )}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ForgotPasswordState, FormData>(
    forgotPasswordAction,
    {},
  );

  if (state.sent) {
    return (
      <div
        role="status"
        className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-3 text-sm text-foreground"
      >
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-success"
          aria-hidden="true"
        />
        <p>
          If that email matches a CoreWorks account, a reset link is on its
          way. The link expires in one hour.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
        />
        {state.fieldErrors?.email ? (
          <p id="email-error" className="text-xs text-danger">
            {state.fieldErrors.email}
          </p>
        ) : null}
      </div>

      <SubmitButton />
    </form>
  );
}
