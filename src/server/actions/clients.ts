"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  archiveClientSchema,
  clientContactSchema,
  createClientSchema,
  deleteClientContactSchema,
  updateClientSchema,
} from "@/lib/validation/client";
import { ForbiddenError, requirePermission } from "@/server/tenancy";
import {
  ClientOperationError,
  createClient,
  deleteClientContact,
  setClientArchived,
  updateClient,
  upsertClientContact,
} from "@/server/services/clients";

import type { FormState } from "./organization";

/**
 * Client server actions.
 *
 * Each authorizes BEFORE reading its input, so an unauthorized caller cannot
 * probe validation behaviour. `organizationId` is never accepted from the
 * form — it comes from the session via requirePermission.
 */

function fieldErrorsFrom(
  flattened: Record<string, string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, messages] of Object.entries(flattened)) {
    const first = messages?.[0];
    if (first) result[key] = first;
  }
  return result;
}

function toFormState(error: unknown): FormState {
  if (error instanceof ForbiddenError || error instanceof ClientOperationError) {
    return { status: "error", message: error.message };
  }
  console.error("Unhandled client action error:", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

function payloadFrom(formData: FormData) {
  return {
    name: formData.get("name"),
    companyName: formData.get("companyName") ?? "",
    industry: formData.get("industry") ?? "",
    businessType: formData.get("businessType") ?? "",
    startDate: formData.get("startDate") ?? "",
    servicePackageId: formData.get("servicePackageId") ?? "",
    accountManagerId: formData.get("accountManagerId") ?? "",
    backupMemberId: formData.get("backupMemberId") ?? "",
    contactName: formData.get("contactName") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    accountingSystem: formData.get("accountingSystem") ?? "",
    reportingFrequency: formData.get("reportingFrequency") ?? "",
    monthEndClosingDay: formData.get("monthEndClosingDay") ?? "",
    contractStatus: formData.get("contractStatus") ?? "ONBOARDING",
    priority: formData.get("priority") ?? "MEDIUM",
    notes: formData.get("notes") ?? "",
  };
}

export async function createClientAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  let createdId: string | null = null;

  try {
    const ctx = await requirePermission("client:create");

    const parsed = createClientSchema.safeParse(payloadFrom(formData));
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    const created = await createClient(ctx, parsed.data);
    createdId = created.id;
    revalidatePath("/clients");
    revalidatePath("/dashboard");
  } catch (error) {
    return toFormState(error);
  }

  // redirect() throws by design, so it must sit outside the try block.
  redirect(`/clients/${createdId}`);
}

export async function updateClientAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("client:update");

    const parsed = updateClientSchema.safeParse({
      clientId: formData.get("clientId"),
      ...payloadFrom(formData),
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateClient(ctx, parsed.data);
    revalidatePath("/clients");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/dashboard");
    return { status: "success", message: "Client updated." };
  } catch (error) {
    return toFormState(error);
  }
}

/** Plain-FormData variant for a bare <form action> archive/restore toggle. */
export async function toggleClientArchivedAction(
  formData: FormData,
): Promise<void> {
  const ctx = await requirePermission("client:archive");

  const parsed = archiveClientSchema.safeParse({
    clientId: formData.get("clientId"),
    archived: formData.get("archived") === "true",
  });
  if (!parsed.success) throw new Error("Invalid request.");

  await setClientArchived(ctx, parsed.data.clientId, parsed.data.archived);
  revalidatePath("/clients");
  revalidatePath(`/clients/${parsed.data.clientId}`);
  revalidatePath("/dashboard");
}

export async function saveClientContactAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("client:update");

    const parsed = clientContactSchema.safeParse({
      clientId: formData.get("clientId"),
      contactId: formData.get("contactId") ?? "",
      name: formData.get("name"),
      role: formData.get("role") ?? "",
      email: formData.get("email") ?? "",
      phone: formData.get("phone") ?? "",
      isPrimary: formData.get("isPrimary") === "on",
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await upsertClientContact(ctx, parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { status: "success", message: "Contact saved." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function deleteClientContactAction(
  formData: FormData,
): Promise<void> {
  const ctx = await requirePermission("client:update");

  const parsed = deleteClientContactSchema.safeParse({
    clientId: formData.get("clientId"),
    contactId: formData.get("contactId"),
  });
  if (!parsed.success) throw new Error("Invalid request.");

  await deleteClientContact(ctx, parsed.data.clientId, parsed.data.contactId);
  revalidatePath(`/clients/${parsed.data.clientId}`);
}
