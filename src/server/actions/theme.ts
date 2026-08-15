"use server";

import { revalidatePath } from "next/cache";

import { isThemeMode } from "@/lib/domain/theme";
import {
  applyPresetSchema,
  setThemeModeSchema,
  updateThemeSchema,
} from "@/lib/validation/theme";
import { ForbiddenError, requireOrgContext, requirePermission } from "@/server/tenancy";
import {
  applyThemePreset,
  resetThemeSettings,
  setUserThemeMode,
  updateThemeSettings,
} from "@/server/services/theme";

import type { FormState } from "./organization";

/**
 * Theme server actions.
 *
 * Two different guards, deliberately:
 *
 *  - The organization's brand needs `branding:manage` — Owner and Admin.
 *    Changing it changes what every colleague sees.
 *  - A person's own light/dark choice needs authentication only. No role
 *    grants sight of another person's eyes.
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
  if (error instanceof ForbiddenError) {
    return { status: "error", message: error.message };
  }
  console.error("Unhandled theme action error:", error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

export async function updateThemeAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("branding:manage");

    const parsed = updateThemeSchema.safeParse({
      preset: formData.get("preset") ?? "custom",
      primaryColor: formData.get("primaryColor") ?? "",
      secondaryColor: formData.get("secondaryColor") ?? "",
      accentColor: formData.get("accentColor") ?? "",
      sidebarColor: formData.get("sidebarColor") ?? "",
      backgroundColor: formData.get("backgroundColor") ?? "",
      defaultMode: formData.get("defaultMode") ?? "system",
      logoUrl: formData.get("logoUrl") ?? "",
    });
    if (!parsed.success) {
      return {
        status: "error",
        fieldErrors: fieldErrorsFrom(parsed.error.flatten().fieldErrors),
      };
    }

    await updateThemeSettings(ctx, parsed.data);

    // The brand is injected by the authenticated layout, so every page under
    // it renders the old palette until its cache entry is dropped.
    revalidatePath("/", "layout");
    return { status: "success", message: "Appearance saved." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function applyThemePresetAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("branding:manage");

    const parsed = applyPresetSchema.safeParse({
      preset: formData.get("preset") ?? "",
    });
    if (!parsed.success) {
      return { status: "error", message: "Unknown preset." };
    }

    await applyThemePreset(ctx, parsed.data.preset);

    revalidatePath("/", "layout");
    return { status: "success", message: "Preset applied." };
  } catch (error) {
    return toFormState(error);
  }
}

export async function resetThemeAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission("branding:manage");
    await resetThemeSettings(ctx);

    revalidatePath("/", "layout");
    return { status: "success", message: "Reset to the CoreWorks palette." };
  } catch (error) {
    return toFormState(error);
  }
}

/**
 * Persists the signed-in user's light/dark choice.
 *
 * Called by the header toggle, which has already applied the change to the
 * DOM and written `localStorage`. This makes it durable so the choice follows
 * the person to another device; a failure here is therefore not worth
 * interrupting them over, which is why the toggle does not await a result.
 */
export async function setThemeModeAction(mode: string): Promise<void> {
  if (!isThemeMode(mode)) return;

  const parsed = setThemeModeSchema.safeParse({ mode });
  if (!parsed.success) return;

  const ctx = await requireOrgContext();
  await setUserThemeMode(ctx, parsed.data.mode);
}
