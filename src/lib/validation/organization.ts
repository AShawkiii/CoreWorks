import { z } from "zod";

/**
 * Organization settings validation (master prompt §34/§37).
 * Parsed on the server; the client form reuses the same schema.
 */

/** URL-safe, lowercase, no leading/trailing or doubled hyphens. */
export const slugSchema = z
  .string()
  .trim()
  .min(2, "Slug must be at least 2 characters.")
  .max(50, "Slug must be at most 50 characters.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens.",
  );

/** Reserved so an organization slug can never shadow an application route. */
const RESERVED_SLUGS = new Set([
  "api",
  "admin",
  "login",
  "logout",
  "settings",
  "dashboard",
  "clients",
  "tasks",
  "issues",
  "requests",
  "team",
  "reports",
  "new",
  "www",
  "app",
  "static",
  "public",
  "assets",
]);

export const organizationSlugSchema = slugSchema.refine(
  (value) => !RESERVED_SLUGS.has(value),
  "That slug is reserved. Choose another.",
);

/**
 * An IANA timezone. Validated against the running Intl database rather than a
 * hardcoded list, so it stays correct as zones change.
 */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required.")
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid IANA timezone, e.g. Europe/London.");

/** ISO 4217 alphabetic code. */
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, "Use a 3-letter ISO currency code, e.g. GBP.")
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code, e.g. GBP.");

export const localeSchema = z
  .string()
  .trim()
  .min(2, "Locale is required.")
  .max(20, "Locale is too long.")
  .regex(
    /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/,
    "Enter a valid locale, e.g. en-GB.",
  );

/**
 * Logo URL. Restricted to https so a logo can never be fetched over plaintext
 * or smuggled in as a javascript:/data: URI.
 */
export const logoUrlSchema = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .url("Enter a valid URL.")
      .max(2048, "URL is too long.")
      .refine(
        (value) => value.startsWith("https://"),
        "Logo URL must start with https://",
      ),
  ])
  .transform((value) => (value === "" ? null : value));

export const updateOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Organization name must be at least 2 characters.")
    .max(120, "Organization name is too long."),
  slug: organizationSlugSchema,
  logoUrl: logoUrlSchema,
  timezone: timezoneSchema,
  currency: currencySchema,
  locale: localeSchema,
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
