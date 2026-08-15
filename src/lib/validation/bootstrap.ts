import { z } from "zod";

import { emailSchema, passwordSchema } from "@/lib/validation/auth";
import { memberNameSchema } from "@/lib/validation/member";
import { organizationSlugSchema } from "@/lib/validation/organization";

/**
 * Validation for the first-organization bootstrap.
 *
 * Composed entirely from the schemas the application already enforces —
 * the same email rule, the same 12-character password floor, the same
 * reserved-word slug check. A bootstrap that accepted a weaker password than
 * the member-invite form would be a hole in the shape of a convenience.
 */

/**
 * Derives a slug from an organization name.
 *
 * Only a *suggestion*: the result is validated by `organizationSlugSchema`
 * like any other slug, so a name that reduces to something reserved or empty
 * is refused with a message telling the operator to pass one explicitly.
 * Guessing further on their behalf would mean an organization silently
 * getting a URL nobody chose.
 */
export function slugifyOrganizationName(name: string): string {
  return name
    .normalize("NFKD")
    // Strip combining marks so "Ångström" becomes "angstrom", not "ngstrm".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const organizationNameSchema = z
  .string()
  .trim()
  .min(2, "Organization name must be at least 2 characters.")
  .max(120, "Organization name is too long.");

export const bootstrapOrganizationSchema = z.object({
  organizationName: organizationNameSchema,
  slug: organizationSlugSchema,
  ownerName: memberNameSchema,
  ownerEmail: emailSchema,
  ownerPassword: passwordSchema,
});

export type BootstrapOrganizationInput = z.infer<
  typeof bootstrapOrganizationSchema
>;
