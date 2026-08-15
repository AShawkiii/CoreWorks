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
import {
  ContractStatus,
  Priority,
  ReportingFrequency,
} from "@/generated/prisma/enums";
import {
  CONTRACT_STATUS_LABELS,
  PRIORITY_LABELS,
} from "@/lib/domain/labels";
import {
  createClientAction,
  updateClientAction,
} from "@/server/actions/clients";
import type { FormState } from "@/server/actions/organization";

export interface ClientFormValues {
  clientId?: string;
  name: string;
  companyName: string;
  industry: string;
  businessType: string;
  startDate: string;
  servicePackageId: string;
  accountManagerId: string;
  backupMemberId: string;
  contactName: string;
  email: string;
  phone: string;
  accountingSystem: string;
  reportingFrequency: string;
  monthEndClosingDay: string;
  contractStatus: ContractStatus;
  priority: Priority;
  notes: string;
}

interface ClientFormProps {
  mode: "create" | "edit";
  values: ClientFormValues;
  packages: { id: string; name: string }[];
  members: { id: string; name: string }[];
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
        "Create client"
      ) : (
        "Save changes"
      )}
    </Button>
  );
}

export function ClientForm({
  mode,
  values,
  packages,
  members,
}: ClientFormProps) {
  const action = mode === "create" ? createClientAction : updateClientAction;
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.fieldErrors ?? {};

  const field = (
    name: keyof ClientFormValues,
    label: string,
    node: React.ReactNode,
    hint?: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {node}
      {errors[name] ? (
        <FieldError id={`${name}-error`} message={errors[name]} />
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {values.clientId ? (
        <input type="hidden" name="clientId" value={values.clientId} />
      ) : null}

      <FormMessage status={state.status} message={state.message} />

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Identity</legend>

        {field(
          "name",
          "Client name",
          <Input
            id="name"
            name="name"
            defaultValue={values.name}
            required
            aria-invalid={errors.name ? true : undefined}
          />,
        )}

        {field(
          "companyName",
          "Company name",
          <Input
            id="companyName"
            name="companyName"
            defaultValue={values.companyName}
          />,
          "A client is a duplicate only when both name and company match.",
        )}

        {field(
          "industry",
          "Industry",
          <Input id="industry" name="industry" defaultValue={values.industry} />,
        )}

        {field(
          "businessType",
          "Business type",
          <Input
            id="businessType"
            name="businessType"
            defaultValue={values.businessType}
          />,
        )}
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Engagement</legend>

        {field(
          "startDate",
          "Start date",
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={values.startDate}
            required
            aria-invalid={errors.startDate ? true : undefined}
          />,
          "Required — the engagement start, used across reporting.",
        )}

        {field(
          "servicePackageId",
          "Service package",
          <Select
            id="servicePackageId"
            name="servicePackageId"
            defaultValue={values.servicePackageId}
            required
            aria-invalid={errors.servicePackageId ? true : undefined}
          >
            <option value="">Select a package…</option>
            {packages.map((pkg) => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name}
              </option>
            ))}
          </Select>,
          "Determines which task templates generate recurring work.",
        )}

        {field(
          "accountManagerId",
          "Account manager",
          <Select
            id="accountManagerId"
            name="accountManagerId"
            defaultValue={values.accountManagerId}
            required
            aria-invalid={errors.accountManagerId ? true : undefined}
          >
            <option value="">Select a manager…</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>,
        )}

        {field(
          "backupMemberId",
          "Backup team member",
          <Select
            id="backupMemberId"
            name="backupMemberId"
            defaultValue={values.backupMemberId}
          >
            <option value="">None</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </Select>,
        )}

        {field(
          "contractStatus",
          "Contract status",
          <Select
            id="contractStatus"
            name="contractStatus"
            defaultValue={values.contractStatus}
          >
            {Object.values(ContractStatus).map((status) => (
              <option key={status} value={status}>
                {CONTRACT_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>,
          "Only Active clients receive monthly task generation.",
        )}

        {field(
          "priority",
          "Priority",
          <Select id="priority" name="priority" defaultValue={values.priority}>
            {Object.values(Priority).map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>,
        )}
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Primary contact</legend>

        {field(
          "contactName",
          "Contact name",
          <Input
            id="contactName"
            name="contactName"
            defaultValue={values.contactName}
          />,
        )}

        {field(
          "email",
          "Email",
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={values.email}
            aria-invalid={errors.email ? true : undefined}
          />,
        )}

        {field(
          "phone",
          "Phone",
          <Input id="phone" name="phone" defaultValue={values.phone} />,
        )}
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Accounting</legend>

        {field(
          "accountingSystem",
          "Accounting system",
          <Input
            id="accountingSystem"
            name="accountingSystem"
            defaultValue={values.accountingSystem}
            placeholder="Xero, QuickBooks…"
          />,
        )}

        {field(
          "reportingFrequency",
          "Reporting frequency",
          <Select
            id="reportingFrequency"
            name="reportingFrequency"
            defaultValue={values.reportingFrequency}
          >
            <option value="">Not set</option>
            {Object.values(ReportingFrequency).map((frequency) => (
              <option key={frequency} value={frequency}>
                {frequency.charAt(0) + frequency.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>,
        )}

        {field(
          "monthEndClosingDay",
          "Month-end closing day",
          <Input
            id="monthEndClosingDay"
            name="monthEndClosingDay"
            type="number"
            min={1}
            max={31}
            defaultValue={values.monthEndClosingDay}
            aria-invalid={errors.monthEndClosingDay ? true : undefined}
          />,
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={values.notes}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <FieldError id="notes-error" message={errors.notes} />
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton mode={mode} />
        <Link
          href={
            values.clientId ? `/clients/${values.clientId}` : "/clients"
          }
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
      </div>

      {mode === "create" ? (
        <p className="text-xs text-muted-foreground">
          Creating a client generates its onboarding tasks from the selected
          service package, then calculates its completion and health.
        </p>
      ) : null}
    </form>
  );
}
