"use server";

import { revalidatePath } from "next/cache";

import { periodSchema } from "@/lib/validation/task";
import { ForbiddenError, requirePermission } from "@/server/tenancy";
import {
  runDailyRecalculation,
  runMonthlyGeneration,
} from "@/server/jobs/scheduled";

import type { FormState } from "./organization";

/**
 * On-demand runs of the scheduled jobs (audit §9).
 *
 * Legacy's menu had "Rebuild Dashboards" and a manual generation entry
 * alongside the timed triggers, for exactly the case this covers: a new
 * client added mid-month, or a suspicion that a figure has gone stale.
 *
 * Both are safe to press twice. Generation is keyed on
 * `clientId|serviceArea|taskName|period`, so a repeat pass creates nothing;
 * recalculation is idempotent by construction.
 *
 * Scoped to the caller's organization — unlike the CLI runner, which sweeps
 * every tenant because a deployment-level cron is signed in as none of them.
 */

function toFormState(error: unknown, fallback: string): FormState {
  if (error instanceof ForbiddenError) {
    return { status: "error", message: error.message };
  }
  console.error(`Unhandled job action error (${fallback}):`, error);
  return { status: "error", message: "Something went wrong. Please try again." };
}

export async function runGenerationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    // Generation expands templates into tasks, so it is gated on the
    // permission that governs the templates themselves.
    const ctx = await requirePermission("template:manage");

    const parsed = periodSchema.safeParse(formData.get("period") ?? "");
    if (!parsed.success) {
      return { status: "error", message: "Use the format YYYY-MM." };
    }

    // A blank period means "the current one", matching the monthly trigger.
    const result = await runMonthlyGeneration(ctx, parsed.data ?? undefined);

    revalidatePath("/tasks");
    revalidatePath("/dashboard");
    revalidatePath("/templates");

    const created = Number(result.details.tasksCreated);
    return {
      status: "success",
      message:
        created === 0
          ? `Nothing to generate for ${result.details.period} — every task already exists.`
          : `Created ${created} task${created === 1 ? "" : "s"} for ${result.details.period} across ${result.details.clientsProcessed} client(s).`,
    };
  } catch (error) {
    return toFormState(error, "generation");
  }
}

export async function runRecalculationAction(
  _prevState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    // Recalculation rewrites every client's health and completion, which is
    // the same reach as managing settings that drive those thresholds.
    const ctx = await requirePermission("settings:manage");

    const result = await runDailyRecalculation(ctx);

    revalidatePath("/dashboard");
    revalidatePath("/clients");

    return {
      status: "success",
      message: `Recalculated ${result.details.clientsProcessed} client(s); ${result.details.healthChanged} health value(s) changed.`,
    };
  } catch (error) {
    return toFormState(error, "recalculation");
  }
}
