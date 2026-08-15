import { z } from "zod";

import { LEGACY_HEADERS, isLegacySheet } from "@/lib/domain/legacy-schema";

/**
 * Import/export validation (master prompt §40/§41, migration-plan §4).
 *
 * The per-row schemas live in the adapters, because each legacy sheet has its
 * own columns and its own rules. What is validated here is the **request**:
 * which sheet, and a file that is plausibly a CSV at all.
 */

export const legacySheetSchema = z
  .string()
  .trim()
  .refine(isLegacySheet, "Unknown data set.");

/**
 * The upload size ceiling.
 *
 * Ten megabytes is far above any real legacy export — the whole system was
 * 7,852 lines of code managing a few thousand rows — and low enough that a
 * mistaken upload cannot exhaust the server parsing it. The limit is enforced
 * on the server; a browser check would be advice, not a boundary.
 */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * A file that is at least plausibly a CSV.
 *
 * Deliberately permissive about the MIME type: browsers report a `.csv` as
 * `text/csv`, `application/vnd.ms-excel`, `application/csv`, or an empty
 * string depending on platform and what else is installed. Rejecting on that
 * basis would block real files for no security benefit, since the content is
 * parsed as text either way and never executed.
 *
 * What IS enforced: a non-empty body within the size limit.
 */
export const importFileSchema = z
  .instanceof(File, { message: "Choose a CSV file." })
  .refine((file) => file.size > 0, "That file is empty.")
  .refine(
    (file) => file.size <= MAX_IMPORT_BYTES,
    `File is larger than ${MAX_IMPORT_BYTES / (1024 * 1024)} MB.`,
  );

export const importRequestSchema = z.object({
  sheet: legacySheetSchema,
  file: importFileSchema,
  /**
   * False previews, true writes.
   *
   * Sent explicitly rather than inferred from which button was pressed, so
   * the server never has to guess whether a request meant to commit. The
   * default is the safe one.
   */
  commit: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true" || value === "1",
    ),
});

export const exportRequestSchema = z.object({
  sheet: legacySheetSchema,
});

export type ImportRequest = z.infer<typeof importRequestSchema>;

/** Every sheet name, for the UI. Derived so it cannot drift from the contract. */
export const LEGACY_SHEET_NAMES = Object.keys(LEGACY_HEADERS);
