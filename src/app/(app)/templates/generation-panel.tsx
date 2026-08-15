"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runGenerationAction } from "@/server/actions/jobs";
import type { FormState } from "@/server/actions/organization";

function RunButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Running…
        </>
      ) : (
        <>
          <RefreshCw aria-hidden="true" />
          {label}
        </>
      )}
    </Button>
  );
}

/**
 * On-demand monthly generation (audit §9).
 *
 * Legacy ran this on a monthly trigger and also exposed it from the menu, for
 * the case where a client is added mid-month. Safe to press twice: generation
 * is keyed on `clientId|serviceArea|taskName|period`, so a repeat pass creates
 * nothing and prior periods are never touched.
 */
export function GenerationPanel({ defaultPeriod }: { defaultPeriod: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    runGenerationAction,
    {},
  );

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Generate recurring tasks</CardTitle>
        <CardDescription>
          Expands every active template for each Active client into the chosen
          period. Runs automatically on the first of the month; this is the
          manual equivalent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3" noValidate>
          <FormMessage status={state.status} message={state.message} />

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="generation-period">Period</Label>
              <Input
                id="generation-period"
                name="period"
                placeholder="YYYY-MM"
                defaultValue={defaultPeriod}
                className="w-40"
              />
            </div>
            <RunButton label="Generate" />
          </div>

          <p className="text-xs text-muted-foreground">
            Safe to run more than once — a task that already exists for the
            period is skipped, and earlier periods are never modified.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
